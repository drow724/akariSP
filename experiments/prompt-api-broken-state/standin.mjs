// Research-only (pre-feature 012): how AkariSP's Prompt API provider classifies clone() rejections.
// DETERMINISTIC_STAND_IN: a fake LanguageModel global behind the public entry (src/index.ts).
// It characterizes AkariSP state transitions only; it proves nothing about native error semantics.
// Usage (Node >= 22.18, repo root): node experiments/prompt-api-broken-state/standin.mjs > out.json
const { createRuntime, TaskError } = await import('../../src/index.ts');

const describe = (v) => v === undefined ? null
  : { ctor: v?.constructor?.name ?? typeof v, name: v?.name ?? null, message: v?.message ?? String(v) };
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
const task = (r) => r.ok ? { code: null } : { code: r.e instanceof TaskError ? r.e.code : 'NOT_TASKERROR', cause: describe(r.e.cause) };

/** A base whose first clone serves a gated task (holds the only slot); later clones call `later`. */
function install(later) {
  const log = { clones: 0, baseDestroys: 0 };
  let open;
  const gate = new Promise((r) => { open = r; });
  const base = {
    async clone(options) {
      log.clones++;
      if (log.clones === 1) return { async prompt() { await gate; return 'A'; }, destroy() {} };
      return later(options);
    },
    destroy() { log.baseDestroys++; },
  };
  globalThis.LanguageModel = { create: async () => base };
  return { log, open };
}

// E1: the clone rejection matrix. limit 1: A holds the slot, B and C queue, A finishes, B clones → X.
const errors = {
  'DOMException InvalidStateError': () => new DOMException('x', 'InvalidStateError'),
  'DOMException AbortError': () => new DOMException('x', 'AbortError'),
  'DOMException OperationError': () => new DOMException('x', 'OperationError'),
  'DOMException NotSupportedError': () => new DOMException('x', 'NotSupportedError'),
  'DOMException NetworkError': () => new DOMException('x', 'NetworkError'),
  'Error': () => new Error('x'),
  'plain { name: InvalidStateError }': () => ({ name: 'InvalidStateError' }),
};
const matrix = {};
for (const [label, make] of Object.entries(errors)) {
  const { log, open } = install(async () => { throw make(); });
  const runtime = await createRuntime({ limit: 1 });
  const a = settle(runtime.run('A'));
  const b = settle(runtime.run('B'));
  const c = settle(runtime.run('C'));
  open();
  await a;
  const B = await b, C = await c;
  const clonesBeforeD = log.clones;
  const D = await settle(runtime.run('D'));
  const row = {
    task: task(B),
    stateAfter: runtime.state,
    queuedTaskC: { ...task(C), cloned: clonesBeforeD >= 3 },
    laterTaskD: { ...task(D), cloned: log.clones > clonesBeforeD },
    baseDestroysBeforeShutdown: log.baseDestroys,
  };
  const s = await settle(runtime.shutdown());
  row.shutdown = { resolved: s.ok, baseDestroys: log.baseDestroys, state: runtime.state };
  matrix[label] = row;
}

// E2: task-local aborts. The stand-in clone honours its signal and, as a worst case, rejects with
// InvalidStateError when aborted, to show whether provider.broken() is reached at all.
const abortMatrix = {};
{
  // E2a: signal already aborted before run()
  const { open } = install(async () => ({ async prompt() { return 'ok'; }, destroy() {} }));
  open();
  const runtime = await createRuntime();
  const ctrl = new AbortController(); ctrl.abort();
  const r = await settle(runtime.run('x', { signal: ctrl.signal }));
  const next = await settle(runtime.run('y'));
  abortMatrix['aborted before run'] = { ...task(r), stateAfter: runtime.state, nextTask: task(next) };
  await runtime.shutdown();
}
{
  // E2b: abort while queued
  const { open } = install(async () => ({ async prompt() { return 'ok'; }, destroy() {} }));
  const runtime = await createRuntime({ limit: 1 });
  const a = settle(runtime.run('A'));
  const ctrl = new AbortController();
  const b = settle(runtime.run('B', { signal: ctrl.signal }));
  ctrl.abort();
  const B = await b; open(); await a;
  const next = await settle(runtime.run('y'));
  abortMatrix['abort while queued'] = { ...task(B), stateAfter: runtime.state, nextTask: task(next) };
  await runtime.shutdown();
}
{
  // E2c: abort during clone; clone rejects InvalidStateError (worst case) once aborted
  let cloneStarted;
  const started = new Promise((r) => { cloneStarted = r; });
  const { open, log } = install((options) => {
    if (log.clones > 2) return { async prompt() { return 'ok'; }, destroy() {} };
    cloneStarted();
    return new Promise((_, rej) => options.signal.addEventListener('abort',
      () => rej(new DOMException('aborted during clone', 'InvalidStateError')), { once: true }));
  });
  open();
  const runtime = await createRuntime();
  await runtime.run('A'); // clone #1
  const ctrl = new AbortController();
  const b = settle(runtime.run('B', { signal: ctrl.signal })); // clone #2 hangs
  await started; ctrl.abort();
  const B = await b;
  const next = await settle(runtime.run('y')); // clone #3 succeeds
  abortMatrix['abort during clone (clone rejects InvalidStateError)'] = { ...task(B), stateAfter: runtime.state, nextTask: task(next) };
  await runtime.shutdown();
}

// E3-model: a stand-in of the *specified* destroyed-model path (writing-assistance-apis
// "destroy" + prompt-api "clone a language model"): once the model's destruction controller is
// aborted, clone() rejects with that controller's abort reason. Three runs after destruction.
const destroyed = {};
for (const [label, abort] of Object.entries({
  'create signal: controller.abort()': (c) => c.abort(),
  'create signal: custom reason': (c) => c.abort(new Error('app shutting down')),
  'base.destroy()': null,
})) {
  const destruction = new AbortController();
  const base = {
    async clone() {
      if (destruction.signal.aborted) throw destruction.signal.reason;
      return { async prompt() { return 'ok'; }, destroy() {} };
    },
    destroy() { if (!destruction.signal.aborted) destruction.abort(new DOMException('destroyed', 'AbortError')); },
  };
  globalThis.LanguageModel = {
    async create(options) {
      options?.signal?.addEventListener('abort', () => destruction.abort(options.signal.reason), { once: true });
      return base;
    },
  };
  const ctrl = new AbortController();
  const runtime = await createRuntime({ session: { signal: ctrl.signal } });
  const first = task(await settle(runtime.run('ok')));
  abort ? abort(ctrl) : base.destroy();
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push({ ...task(await settle(runtime.run(`after ${i}`))), stateAfter: runtime.state });
  const s = await settle(runtime.shutdown());
  destroyed[label] = { beforeDestruction: first, runsAfter: runs, shutdownResolved: s.ok };
}

delete globalThis.LanguageModel;
console.log(JSON.stringify({
  environment: { node: process.version, platform: process.platform, date: new Date().toISOString().slice(0, 10) },
  evidenceClass: 'DETERMINISTIC_STAND_IN',
  cloneRejectionMatrix: matrix,
  taskLocalAbort: abortMatrix,
  specModelledDestroyedBase: destroyed,
}, null, 2));
