import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createRuntime, TaskError } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fake LanguageModel. Hook modes express AkariSP race scenarios, not claims about
// Chrome's behavior.
// ---------------------------------------------------------------------------

type Signal = AbortSignal | undefined;
type CloneHook = (src: FakeSession, signal: Signal) => Promise<FakeSession>;
type PromptHook = (signal: Signal, input: unknown) => Promise<string>;

let fake: {
  live: number;
  liveClones: number;
  maxLiveClones: number;
  creates: number;
  clones: number;
  destroys: number;
  createArgs: unknown[];
  base: FakeSession | undefined;
  sessions: FakeSession[];
  cloneHooks: CloneHook[];
  promptHooks: PromptHook[];
  createError: unknown;
  destroyThrows: boolean;
  onDestroy: (() => void) | undefined;
};

class FakeSession {
  prompts = 0;
  destroyed = false;
  isBase: boolean;
  history: unknown[];
  constructor(isBase: boolean, history: unknown[]) {
    this.isBase = isBase;
    this.history = history;
    fake.live++;
    fake.sessions.push(this);
    if (!isBase) {
      fake.liveClones++;
      fake.maxLiveClones = Math.max(fake.maxLiveClones, fake.liveClones);
    }
  }
  async clone(options: { signal?: AbortSignal } = {}) {
    fake.clones++;
    const hook = fake.cloneHooks.shift();
    if (hook) return hook(this, options.signal);
    return new FakeSession(false, [...this.history]);
  }
  async prompt(input: unknown, options: { signal?: AbortSignal } = {}) {
    if (this.destroyed) throw new DOMException('destroyed', 'InvalidStateError');
    this.prompts++;
    this.history.push(input);
    const hook = fake.promptHooks.shift();
    if (hook) return hook(options.signal, input);
    return `reply:${JSON.stringify(this.history)}`;
  }
  destroy() {
    fake.destroys++;
    fake.onDestroy?.();
    if (!this.destroyed) {
      this.destroyed = true;
      fake.live--;
      if (!this.isBase) fake.liveClones--;
    }
    if (fake.destroyThrows) throw new Error('destroy failed');
  }
}

beforeEach(() => {
  fake = {
    live: 0, liveClones: 0, maxLiveClones: 0, creates: 0, clones: 0, destroys: 0,
    createArgs: [], base: undefined, sessions: [], cloneHooks: [], promptHooks: [],
    createError: undefined, destroyThrows: false, onDestroy: undefined,
  };
  (globalThis as any).LanguageModel = {
    async create(options?: { initialPrompts?: unknown[] }) {
      fake.creates++;
      fake.createArgs.push(options);
      if (fake.createError) throw fake.createError;
      return (fake.base = new FakeSession(true, [...(options?.initialPrompts ?? [])]));
    },
  };
});

function deferred<T = void>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

/** Next prompt waits for release(); honors its signal. */
function holdPrompt(reply = 'held') {
  const gate = deferred<string>();
  fake.promptHooks.push((signal) => {
    signal?.addEventListener('abort', () => gate.reject(signal.reason), { once: true });
    return gate.promise;
  });
  return { release: () => gate.resolve(reply), fail: gate.reject };
}

/** Next clone: mode 'honor' rejects with signal.reason on abort; 'late' ignores the signal. */
function holdClone(mode: 'honor' | 'late') {
  const gate = deferred<void>();
  fake.cloneHooks.push(async (src, signal) => {
    if (mode === 'honor') {
      signal?.addEventListener('abort', () => gate.reject(signal.reason), { once: true });
    }
    await gate.promise;
    return new FakeSession(false, [...src.history]);
  });
  return { release: () => gate.resolve() };
}

function failNextClone(error: unknown) {
  fake.cloneHooks.push(() => Promise.reject(error));
}

function failNextPrompt(error: unknown) {
  fake.promptHooks.push(() => Promise.reject(error));
}

async function rejection(p: Promise<unknown>): Promise<TaskError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof TaskError, `expected TaskError, got ${e}`);
    return e;
  }
  assert.fail('expected rejection');
}

/** Tracks whether a promise has settled, without consuming its rejection. */
function track<T>(p: Promise<T>) {
  const s = { settled: false, promise: p };
  p.then(() => { s.settled = true; }, () => { s.settled = true; });
  return s;
}

// ---------------------------------------------------------------------------
// Foundational (T008)
// ---------------------------------------------------------------------------

test('invalid limit / queueCapacity reject TypeError before create', async () => {
  for (const options of [
    { limit: 0 }, { limit: 1.5 },
    { queueCapacity: -1 }, { queueCapacity: 1.5 }, { queueCapacity: Infinity },
  ]) {
    await assert.rejects(createRuntime(options), TypeError);
  }
  assert.equal(fake.creates, 0);
});

test('create rejection propagates unchanged', async () => {
  const error = new DOMException('no model', 'NotAllowedError');
  fake.createError = error;
  await assert.rejects(createRuntime(), (e) => e === error);
});

test('new runtime is ready and session options pass to create unchanged', async () => {
  const session = { initialPrompts: [{ role: 'system', content: 'be terse' }], temperature: 0.5 };
  const runtime = await createRuntime({ session });
  assert.equal(runtime.state, 'ready');
  assert.equal(fake.creates, 1);
  assert.equal(fake.createArgs[0], session);
});

// ---------------------------------------------------------------------------
// US1 — isolated tasks from a warm base session (T009)
// ---------------------------------------------------------------------------

test('run clones, prompts the clone, destroys it, never prompts the base', async () => {
  const runtime = await createRuntime({ session: { initialPrompts: ['sys'] } });
  const result = await runtime.run('hello');
  assert.equal(result.output, 'reply:["sys","hello"]');
  assert.equal(fake.base!.prompts, 0);
  assert.equal(fake.clones, 1);
  assert.equal(fake.destroys, 1);
  assert.equal(fake.live, 1);
});

test('task B sees only the base context, not task A (SC-004)', async () => {
  const runtime = await createRuntime({ session: { initialPrompts: ['sys'] } });
  await runtime.run('remember X');
  const b = await runtime.run('what word?');
  assert.equal(b.output, 'reply:["sys","what word?"]');
  assert.deepEqual(fake.base!.history, ['sys']);
});

test('concurrent runs each use a distinct clone', async () => {
  const runtime = await createRuntime({ limit: 3 });
  const holds = [holdPrompt('a'), holdPrompt('b'), holdPrompt('c')];
  const runs = ['1', '2', '3'].map((x) => runtime.run(x));
  await tick();
  assert.equal(fake.liveClones, 3);
  holds.forEach((h) => h.release());
  assert.deepEqual((await Promise.all(runs)).map((r) => r.output), ['a', 'b', 'c']);
  assert.equal(new Set(fake.sessions.filter((s) => !s.isBase)).size, 3);
  assert.equal(fake.live, 1);
});

// ---------------------------------------------------------------------------
// US2 — cancellation, failure, cleanup, broken transition (T011)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('already-aborted signal: cancelled, no clone', async () => {
  const runtime = await createRuntime();
  const ctrl = new AbortController();
  ctrl.abort();
  const e = await rejection(runtime.run('x', { signal: ctrl.signal }));
  assert.equal(e.code, 'cancelled');
  assert.equal(e.cause, ctrl.signal.reason);
  assert.equal(fake.clones, 0);
});

test('abort during prompt: cancelled with signal reason, clone destroyed', async () => {
  const runtime = await createRuntime();
  holdPrompt();
  const ctrl = new AbortController();
  const p = runtime.run('x', { signal: ctrl.signal });
  await tick();
  ctrl.abort();
  const e = await rejection(p);
  assert.equal(e.code, 'cancelled');
  assert.equal(e.cause, ctrl.signal.reason);
  assert.equal(fake.live, 1);
});

test('clone race A: clone rejects on abort → cancelled, nothing leaked, no acquire', async () => {
  const runtime = await createRuntime();
  holdClone('honor');
  const ctrl = new AbortController();
  const p = runtime.run('x', { signal: ctrl.signal });
  await tick();
  ctrl.abort();
  const e = await rejection(p);
  assert.equal(e.code, 'cancelled');
  assert.equal(e.timing.acquire, undefined);
  assert.equal(fake.liveClones, 0);
});

test('clone race B: late clone is destroyed before the task settles, never prompted', async () => {
  const runtime = await createRuntime();
  const clone = holdClone('late');
  const ctrl = new AbortController();
  const p = track(runtime.run('x', { signal: ctrl.signal }));
  await tick();
  ctrl.abort();
  await tick();
  assert.equal(p.settled, false);
  const liveAtSettle = p.promise.catch(() => fake.live);
  clone.release();
  const e = await rejection(p.promise);
  assert.equal(e.code, 'cancelled');
  assert.equal(await liveAtSettle, 1);
  const late = fake.sessions.find((s) => !s.isBase)!;
  assert.equal(late.prompts, 0);
  assert.equal(late.destroyed, true);
  assert.equal(typeof e.timing.acquire, 'number');
});

test('timeout during acquisition (late clone): cancelled TimeoutError, clone destroyed, acquire recorded', async () => {
  const runtime = await createRuntime();
  const clone = holdClone('late');
  const p = runtime.run('x', { signal: AbortSignal.timeout(20) });
  await sleep(40);
  clone.release();
  const e = await rejection(p);
  assert.equal(e.code, 'cancelled');
  assert.equal((e.cause as Error).name, 'TimeoutError');
  assert.equal(typeof e.timing.acquire, 'number');
  assert.equal(e.timing.prompt, undefined);
  assert.equal(typeof e.timing.total, 'number');
  assert.equal(fake.sessions.find((s) => !s.isBase)!.prompts, 0);
  assert.equal(fake.live, 1);
});

test('timeout during acquisition (clone honors signal): no acquire', async () => {
  const runtime = await createRuntime();
  holdClone('honor');
  const pending = rejection(runtime.run('x', { signal: AbortSignal.timeout(20) }));
  await sleep(40); // AbortSignal.timeout's timer does not keep Node's event loop alive
  const e = await pending;
  assert.equal(e.code, 'cancelled');
  assert.equal((e.cause as Error).name, 'TimeoutError');
  assert.equal(e.timing.acquire, undefined);
  assert.equal(fake.liveClones, 0);
});

test('timeout during prompt: cancelled TimeoutError, clone destroyed', async () => {
  const runtime = await createRuntime();
  holdPrompt();
  const pending = rejection(runtime.run('x', { signal: AbortSignal.timeout(20) }));
  await sleep(40);
  const e = await pending;
  assert.equal(e.code, 'cancelled');
  assert.equal((e.cause as Error).name, 'TimeoutError');
  assert.equal(typeof e.timing.acquire, 'number');
  assert.equal(e.timing.prompt, undefined);
  assert.equal(fake.live, 1);
});

test('prompt failure: failed with original cause, clone destroyed, runtime still usable', async () => {
  const runtime = await createRuntime();
  const error = new DOMException('filtered', 'NotReadableError');
  failNextPrompt(error);
  const e = await rejection(runtime.run('x'));
  assert.equal(e.code, 'failed');
  assert.equal(e.cause, error);
  assert.equal(fake.live, 1);
  assert.ok(await runtime.run('again'));
});

test('destroy throwing does not replace the outcome', async () => {
  const runtime = await createRuntime();
  fake.destroyThrows = true;
  assert.ok((await runtime.run('x')).output);
  failNextPrompt(new Error('boom'));
  assert.equal((await rejection(runtime.run('y'))).code, 'failed');
});

test('abort right after prompt resolved keeps the success', async () => {
  const runtime = await createRuntime();
  const h = holdPrompt('done');
  const ctrl = new AbortController();
  const p = runtime.run('x', { signal: ctrl.signal });
  await tick();
  h.release();
  ctrl.abort();
  assert.equal((await p).output, 'done');
  assert.equal(fake.live, 1);
});

test('transient clone failure: failed, runtime stays ready', async () => {
  const runtime = await createRuntime();
  const error = new DOMException('quota', 'QuotaExceededError');
  failNextClone(error);
  const e = await rejection(runtime.run('x'));
  assert.equal(e.code, 'failed');
  assert.equal(e.cause, error);
  assert.equal(runtime.state, 'ready');
  assert.ok(await runtime.run('again'));
});

test('clone InvalidStateError: broken, later runs rejected without clone, no recreate', async () => {
  const runtime = await createRuntime();
  const error = new DOMException('gone', 'InvalidStateError');
  failNextClone(error);
  const e = await rejection(runtime.run('x'));
  assert.equal(e.code, 'broken');
  assert.equal(e.cause, error);
  assert.equal(runtime.state, 'broken');
  assert.equal((await rejection(runtime.run('y'))).code, 'broken');
  assert.equal(fake.clones, 1);
  assert.equal(fake.creates, 1);
});

// ---------------------------------------------------------------------------
// US3 — timing semantics (T014)
// ---------------------------------------------------------------------------

test('timing: success has all fields, partial timing on failures', async () => {
  const runtime = await createRuntime();
  const ok = (await runtime.run('x')).timing;
  for (const k of ['queueWait', 'acquire', 'prompt', 'total'] as const) {
    assert.ok(typeof ok[k] === 'number' && ok[k]! >= 0, k);
  }
  assert.ok(ok.total >= ok.queueWait! + ok.acquire! + ok.prompt!);

  const ctrl = new AbortController();
  ctrl.abort();
  const pre = (await rejection(runtime.run('x', { signal: ctrl.signal }))).timing;
  assert.deepEqual(Object.keys(pre), ['total']);

  failNextPrompt(new Error('boom'));
  const pf = (await rejection(runtime.run('x'))).timing;
  assert.equal(typeof pf.queueWait, 'number');
  assert.equal(typeof pf.acquire, 'number');
  assert.equal(pf.prompt, undefined);

  failNextClone(new Error('boom'));
  const cf = (await rejection(runtime.run('x'))).timing;
  assert.equal(cf.acquire, undefined);
  assert.equal(cf.prompt, undefined);
  assert.equal(typeof cf.total, 'number');
});

// ---------------------------------------------------------------------------
// US4 — bounded concurrency (T019, T020)
// ---------------------------------------------------------------------------

test('limit 2, queue 1, 5 tasks: 2 run, 1 waits, 2 rejected with total-only timing', async () => {
  const runtime = await createRuntime({ limit: 2, queueCapacity: 1 });
  const holds = [holdPrompt('a'), holdPrompt('b'), holdPrompt('c')];
  const ok = [runtime.run('1'), runtime.run('2'), runtime.run('3')];
  const rejected = [rejection(runtime.run('4')), rejection(runtime.run('5'))];
  await tick();
  assert.equal(fake.clones, 2);
  for (const e of await Promise.all(rejected)) {
    assert.equal(e.code, 'rejected');
    assert.equal(typeof e.timing.total, 'number');
    assert.equal(e.timing.queueWait, undefined);
    assert.equal(e.timing.acquire, undefined);
    assert.equal(e.timing.prompt, undefined);
  }
  holds[0].release();
  await tick();
  holds[1].release();
  holds[2].release();
  await Promise.all(ok);
  assert.equal(fake.clones, 3);
  assert.equal(fake.maxLiveClones, 2);
  assert.equal(fake.live, 1);
});

test('slot is released only after the task session is destroyed', async () => {
  const runtime = await createRuntime({ limit: 1 });
  const hold = holdPrompt();
  const a = runtime.run('a');
  const b = runtime.run('b');
  await tick();
  let clonesAtDestroy = -1;
  fake.onDestroy = () => { clonesAtDestroy = fake.clones; fake.onDestroy = undefined; };
  hold.release();
  await Promise.all([a, b]);
  assert.equal(clonesAtDestroy, 1);
  assert.equal(fake.clones, 2);
});

test('waiting tasks start in FIFO order', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 3 });
  const hold = holdPrompt();
  const runs = ['A', 'B', 'C', 'D'].map((x) => runtime.run(x));
  await tick();
  hold.release();
  await Promise.all(runs);
  assert.deepEqual(fake.sessions.filter((s) => !s.isBase).map((s) => s.history.at(-1)), ['A', 'B', 'C', 'D']);
});

test('aborting a waiting task: cancelled, no clone, queueWait and total only', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const hold = holdPrompt();
  const a = runtime.run('a');
  const ctrl = new AbortController();
  const b = rejection(runtime.run('b', { signal: ctrl.signal }));
  await tick();
  ctrl.abort();
  const e = await b;
  assert.equal(e.code, 'cancelled');
  assert.equal(e.cause, ctrl.signal.reason);
  assert.equal(typeof e.timing.queueWait, 'number');
  assert.equal(e.timing.acquire, undefined);
  assert.equal(fake.clones, 1);
  hold.release();
  await a;
});

test('shared caller signal leaves no abort listeners behind', async () => {
  const listeners = (s: AbortSignal) => getEventListeners(s, 'abort').length;

  // waiter starts running
  let ctrl = new AbortController();
  let runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  let hold = holdPrompt();
  const a = runtime.run('a', { signal: ctrl.signal });
  const b = runtime.run('b', { signal: ctrl.signal });
  await tick();
  assert.equal(listeners(ctrl.signal), 1);
  hold.release();
  await Promise.all([a, b]);
  assert.equal(listeners(ctrl.signal), 0);

  // waiter aborted (shared signal cancels both)
  ctrl = new AbortController();
  holdPrompt();
  const c = rejection(runtime.run('c', { signal: ctrl.signal }));
  const d = rejection(runtime.run('d', { signal: ctrl.signal }));
  await tick();
  ctrl.abort();
  await Promise.all([c, d]);
  assert.equal(listeners(ctrl.signal), 0);

  // waiter rejected on broken
  ctrl = new AbortController();
  runtime = await createRuntime({ limit: 2, queueCapacity: 1 });
  hold = holdPrompt();
  const e1 = runtime.run('e1', { signal: ctrl.signal });
  await tick();
  failNextClone(new DOMException('gone', 'InvalidStateError'));
  const e2 = rejection(runtime.run('e2'));
  const e3 = rejection(runtime.run('e3', { signal: ctrl.signal }));
  assert.equal((await e2).code, 'broken');
  assert.equal((await e3).code, 'broken');
  assert.equal(listeners(ctrl.signal), 0);
  hold.release();
  await e1;

  // 50 sequential runs reusing one signal
  ctrl = new AbortController();
  runtime = await createRuntime();
  for (let i = 0; i < 50; i++) await runtime.run(`r${i}`, { signal: ctrl.signal });
  assert.equal(listeners(ctrl.signal), 0);
});

test('queueCapacity 0 rejects as soon as the limit is reached', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 0 });
  const hold = holdPrompt();
  const a = runtime.run('a');
  assert.equal((await rejection(runtime.run('b'))).code, 'rejected');
  hold.release();
  await a;
});

test('a failed or cancelled running task frees its slot for the next waiter', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 2 });
  const hold = holdPrompt();
  const ctrl = new AbortController();
  const holdB = holdPrompt();
  const a = rejection(runtime.run('a'));
  const b = rejection(runtime.run('b', { signal: ctrl.signal }));
  const c = runtime.run('c');
  await tick();
  hold.fail(new Error('boom'));
  assert.equal((await a).code, 'failed');
  await tick();
  ctrl.abort();
  assert.equal((await b).code, 'cancelled');
  assert.ok((await c).output);
  holdB.release();
});

test('defaults: limit 1, queue 32, then reject', async () => {
  const runtime = await createRuntime();
  const hold = holdPrompt();
  const runs = Array.from({ length: 33 }, (_, i) => runtime.run(`t${i}`));
  assert.equal((await rejection(runtime.run('overflow'))).code, 'rejected');
  hold.release();
  await Promise.all(runs);
  assert.equal(fake.maxLiveClones, 1);
});

test('a waited task reports queueWait > 0', async () => {
  const runtime = await createRuntime();
  const hold = holdPrompt();
  const a = runtime.run('a');
  const b = runtime.run('b');
  await sleep(5);
  hold.release();
  await a;
  assert.ok((await b).timing.queueWait! > 0);
});

test('burst of 100: running tasks never exceed the limit, every task settles (SC-006)', async () => {
  const runtime = await createRuntime({ limit: 2, queueCapacity: 4 });
  for (let i = 0; i < 100; i++) fake.promptHooks.push(async () => { await tick(); return 'ok'; });
  const ctrls = Array.from({ length: 100 }, () => new AbortController());
  const runs = ctrls.map((c, i) => runtime.run(`t${i}`, { signal: c.signal }));
  ctrls[3].abort();
  ctrls[4].abort();
  const results = await Promise.allSettled(runs);
  const codes = results.map((r) => (r.status === 'fulfilled' ? 'ok' : (r.reason as TaskError).code));
  assert.ok(codes.every((c) => ['ok', 'rejected', 'cancelled'].includes(c)));
  assert.equal(codes.filter((c) => c === 'cancelled').length, 2);
  assert.equal(codes.filter((c) => c === 'rejected').length, 94);
  assert.ok(fake.maxLiveClones <= 2);
  assert.equal(fake.live, 1);
});

test('broken under concurrency: running task A still completes (T020)', async () => {
  const runtime = await createRuntime({ limit: 2, queueCapacity: 1 });
  const hold = holdPrompt('A done');
  const a = runtime.run('A');
  await tick();
  failNextClone(new DOMException('gone', 'InvalidStateError'));
  const b = rejection(runtime.run('B'));
  const c = rejection(runtime.run('C'));
  assert.equal((await b).code, 'broken');
  assert.equal(runtime.state, 'broken');
  assert.equal((await c).code, 'broken');
  assert.equal((await rejection(runtime.run('D'))).code, 'broken');
  assert.equal(fake.clones, 2);
  hold.release();
  assert.equal((await a).output, 'A done');
  assert.equal(fake.live, 1);
});

// ---------------------------------------------------------------------------
// US5 — shutdown (T022, T023)
// ---------------------------------------------------------------------------

test('shutdown cancels running (AbortError), rejects queued (closed), destroys everything', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  holdPrompt();
  const ctrl = new AbortController();
  const a = rejection(runtime.run('a'));
  const b = rejection(runtime.run('b', { signal: ctrl.signal }));
  await tick();
  await runtime.shutdown();
  assert.equal(fake.live, 0);
  assert.equal(runtime.state, 'closed');
  const ea = await a;
  assert.equal(ea.code, 'cancelled');
  assert.equal((ea.cause as Error).name, 'AbortError');
  const eb = await b;
  assert.equal(eb.code, 'closed');
  assert.equal(typeof eb.timing.queueWait, 'number');
  assert.equal(getEventListeners(ctrl.signal, 'abort').length, 0);
  const clones = fake.clones;
  assert.equal((await rejection(runtime.run('c'))).code, 'closed');
  assert.equal(fake.clones, clones);
});

test('shutdown waits for a late clone to be destroyed before resolving', async () => {
  const runtime = await createRuntime();
  const clone = holdClone('late');
  const a = rejection(runtime.run('a'));
  await tick();
  const s = track(runtime.shutdown());
  await tick();
  assert.equal(s.settled, false);
  clone.release();
  await s.promise;
  assert.equal(fake.live, 0);
  assert.equal(fake.sessions.find((x) => !x.isBase)!.prompts, 0);
  assert.equal((await a).code, 'cancelled');
});

test('shutdown is idempotent: same promise, never rejects, cleanup once', async () => {
  const runtime = await createRuntime();
  fake.destroyThrows = true;
  const s1 = runtime.shutdown();
  const s2 = runtime.shutdown();
  assert.equal(s1, s2);
  await Promise.all([s1, s2]);
  const destroys = fake.destroys;
  assert.equal(runtime.shutdown(), s1);
  await runtime.shutdown();
  assert.equal(fake.destroys, destroys);
});

test('shutdown from broken destroys the base; running task is cancelled', async () => {
  const runtime = await createRuntime({ limit: 2 });
  holdPrompt();
  const a = rejection(runtime.run('A'));
  await tick();
  failNextClone(new DOMException('gone', 'InvalidStateError'));
  assert.equal((await rejection(runtime.run('B'))).code, 'broken');
  await runtime.shutdown();
  const ea = await a;
  assert.equal(ea.code, 'cancelled');
  assert.equal((ea.cause as Error).name, 'AbortError');
  assert.equal(fake.live, 0);
  assert.equal(runtime.state, 'closed');
});

test('prompt resolving in the same tick as shutdown yields exactly one outcome', async () => {
  const runtime = await createRuntime();
  const hold = holdPrompt('done');
  const a = runtime.run('a');
  await tick();
  hold.release();
  const s = runtime.shutdown();
  const outcome = await a.then((r) => r.output, (e: TaskError) => e.code);
  assert.ok(outcome === 'done' || outcome === 'cancelled');
  await s;
  assert.equal(fake.live, 0);
});

test('100 mixed tasks then shutdown: every task settles, no session left (SC-003)', async () => {
  const runtime = await createRuntime({ limit: 4, queueCapacity: 100 });
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let i = 0; i < 100; i++) {
    fake.promptHooks.push(async () => {
      await sleep(rand() * 3);
      if (i % 5 === 0) throw new Error('prompt failed');
      return 'ok';
    });
  }
  const runs = Array.from({ length: 100 }, (_, i) => {
    const ctrl = new AbortController();
    if (i % 7 === 0) setTimeout(() => ctrl.abort(), rand() * 20);
    return runtime.run(`t${i}`, { signal: ctrl.signal });
  });
  const settled = Promise.allSettled(runs);
  await sleep(15);
  await runtime.shutdown();
  const results = await settled;
  const codes = new Set(results.map((r) => (r.status === 'fulfilled' ? 'ok' : (r.reason as TaskError).code)));
  assert.ok([...codes].every((c) => ['ok', 'failed', 'cancelled', 'closed'].includes(c)), [...codes].join());
  assert.equal(fake.live, 0);
  assert.equal(fake.destroys, fake.clones + 1);
});
