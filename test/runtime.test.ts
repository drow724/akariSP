import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createCoreRuntime, TaskError, type RuntimeOptions } from '../src/core/runtime.ts';

// ---------------------------------------------------------------------------
// Fake session provider. Hook modes express AkariSP race scenarios, not claims about
// Chrome's behavior.
// ---------------------------------------------------------------------------

type Signal = AbortSignal | undefined;
type CloneHook = (src: FakeSession, signal: Signal) => Promise<FakeSession>;
type PromptHook = (signal: Signal, input: unknown) => Promise<string>;
/** One provider stream: string = chunk, { hold } = wait for release, { error } = throw. */
type StreamStep = string | { hold: Promise<void> } | { error: unknown };

let provider: any;
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
  streamHooks: StreamStep[][];
  streams: number;
  streamSignals: Signal[];
  createError: unknown;
  destroyThrows: boolean;
  onDestroy: (() => void) | undefined;
};

class FakeSession {
  prompts = 0;
  destroyed = false;
  streamReturned = false;
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
  async *promptStreaming(input: unknown, options: { signal?: AbortSignal } = {}) {
    const { signal } = options;
    fake.streams++;
    fake.streamSignals.push(signal);
    this.history.push(input);
    const steps = fake.streamHooks.shift() ?? ['a', 'b', 'c'];
    let completed = false;
    try {
      for (const step of steps) {
        if (typeof step === 'string') yield step;
        else if ('error' in step) throw step.error;
        else {
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason);
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
            step.hold.then(resolve);
          });
        }
      }
      completed = true;
    } finally {
      if (!completed) this.streamReturned = true;
    }
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
    streamHooks: [], streams: 0, streamSignals: [],
    createError: undefined, destroyThrows: false, onDestroy: undefined,
  };
  provider = {
    async create(options?: { initialPrompts?: unknown[] }) {
      fake.creates++;
      fake.createArgs.push(options);
      if (fake.createError) throw fake.createError;
      return (fake.base = new FakeSession(true, [...(options?.initialPrompts ?? [])]));
    },
    start: (base: FakeSession, options: { signal: AbortSignal }) => base.clone(options),
    broken: (e: unknown) => e instanceof DOMException && e.name === 'InvalidStateError',
    destroy: (base: FakeSession) => base.destroy(),
  };
});

const createRuntime = (options?: RuntimeOptions) => createCoreRuntime(provider, options);

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

/** Next provider stream yields `chunks`, then waits for release() before `rest`. */
function holdStream(chunks: string[], rest: string[] = []) {
  const gate = deferred<void>();
  fake.streamHooks.push([...chunks, { hold: gate.promise }, ...rest]);
  return { release: () => gate.resolve() };
}

/** Next provider stream yields `chunks`, then throws `error`. */
function failStream(chunks: string[], error: unknown) {
  fake.streamHooks.push([...chunks, { error }]);
}

async function collect(stream: AsyncIterable<string>) {
  const chunks: string[] = [];
  for await (const c of stream) chunks.push(c);
  return chunks;
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

// 005 T005: pins the existing condition (DOMException named InvalidStateError); not new behavior.
test('clone error named InvalidStateError but not a DOMException: failed, not broken', async () => {
  const runtime = await createRuntime();
  const error = { name: 'InvalidStateError' };
  failNextClone(error);
  const e = await rejection(runtime.run('x'));
  assert.equal(e.code, 'failed');
  assert.equal(e.cause, error);
  assert.equal(runtime.state, 'ready');
  await runtime.run('y');
  assert.equal(fake.clones, 2);
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

// ===========================================================================
// 002 — streaming
// ===========================================================================

// US1 — consume output incrementally (T005)

test('stream: chunks in order, cleanup before loop ends, final timing', async () => {
  const runtime = await createRuntime();
  const stream = runtime.stream('hi');
  const seen: unknown[] = [];
  for await (const chunk of stream) {
    seen.push(chunk);
    assert.equal(stream.timing, undefined);
  }
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(fake.live, 1);
  assert.equal(fake.base!.prompts, 0);
  assert.equal(fake.streams, 1);
  const t = stream.timing!;
  for (const k of ['queueWait', 'acquire', 'prompt', 'total'] as const) assert.equal(typeof t[k], 'number', k);
});

test('stream: distinct clones and isolated context', async () => {
  const runtime = await createRuntime({ session: { initialPrompts: ['sys'] } });
  await collect(runtime.stream('remember X'));
  await collect(runtime.stream('what word?'));
  const [a, b] = fake.sessions.filter((s) => !s.isBase);
  assert.notEqual(a, b);
  assert.deepEqual(a.history, ['sys', 'remember X']);
  assert.deepEqual(b.history, ['sys', 'what word?']);
  assert.deepEqual(fake.base!.history, ['sys']);
});

test('stream: zero chunks ends normally', async () => {
  const runtime = await createRuntime();
  fake.streamHooks.push([]);
  assert.deepEqual(await collect(runtime.stream('x')), []);
  assert.equal(fake.live, 1);
});

test('stream: lazy — never iterated uses no clone, provider call, or slot', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 0 });
  const stream = runtime.stream('x');
  assert.equal(fake.clones, 0);
  assert.equal(fake.streams, 0);
  assert.equal(stream.timing, undefined);
  assert.ok(await runtime.run('y'));
});

test('stream: first pull after shutdown → closed; after broken → broken', async () => {
  let runtime = await createRuntime();
  let stream = runtime.stream('x');
  await runtime.shutdown();
  let e = await rejection(collect(stream));
  assert.equal(e.code, 'closed');
  assert.equal(stream.timing, e.timing);

  runtime = await createRuntime();
  stream = runtime.stream('x');
  failNextClone(new DOMException('gone', 'InvalidStateError'));
  await rejection(runtime.run('y'));
  e = await rejection(collect(stream));
  assert.equal(e.code, 'broken');
  assert.equal(stream.timing, e.timing);
});

test('stream: single use — second iteration throws TypeError without a clone', async () => {
  const runtime = await createRuntime();
  const stream = runtime.stream('x');
  await collect(stream);
  const clones = fake.clones;
  await assert.rejects(collect(stream), TypeError);
  assert.equal(fake.clones, clones);
});

// US2 — stop early without leaking (T007)

test('stream: break cancels the provider stream and cleans up before the loop exits', async () => {
  const runtime = await createRuntime();
  const stream = runtime.stream('x');
  for await (const _ of stream) break;
  const clone = fake.sessions.find((s) => !s.isBase)!;
  assert.equal(clone.streamReturned, true);
  assert.equal(clone.destroyed, true);
  assert.equal(fake.live, 1);
  assert.equal(stream.timing!.prompt, undefined);
  assert.equal(typeof stream.timing!.total, 'number');
});

test('stream: break hands the slot to a queued run() (SC-103)', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const held = holdStream(['a1'], ['a2']);
  const it = runtime.stream('A')[Symbol.asyncIterator]();
  assert.deepEqual(await it.next(), { value: 'a1', done: false });
  const b = runtime.run('B');
  await tick();
  assert.equal(fake.clones, 1);
  let clonesAtDestroy = -1;
  fake.onDestroy = () => { clonesAtDestroy = fake.clones; fake.onDestroy = undefined; };
  await it.return(undefined);
  assert.equal(clonesAtDestroy, 1);
  assert.ok((await b).output);
  held.release();
});

test('stream: return() before any next() admits nothing', async () => {
  const runtime = await createRuntime();
  await runtime.stream('x')[Symbol.asyncIterator]().return(undefined);
  assert.equal(fake.clones, 0);
});

// US3 — cancellation, timeout, failure, shutdown (T009)

test('stream: caller abort while awaiting a chunk → cancelled, cleaned up', async () => {
  const runtime = await createRuntime();
  holdStream(['a']);
  const ctrl = new AbortController();
  const it = runtime.stream('x', { signal: ctrl.signal })[Symbol.asyncIterator]();
  await it.next();
  const pending = rejection(it.next());
  await tick();
  ctrl.abort();
  const e = await pending;
  assert.equal(e.code, 'cancelled');
  assert.equal(e.cause, ctrl.signal.reason);
  assert.equal(fake.live, 1);
});

test('stream: timeout mid-stream → cancelled TimeoutError', async () => {
  const runtime = await createRuntime();
  holdStream(['a']);
  const pending = rejection(collect(runtime.stream('x', { signal: AbortSignal.timeout(20) })));
  await sleep(40);
  const e = await pending;
  assert.equal(e.code, 'cancelled');
  assert.equal((e.cause as Error).name, 'TimeoutError');
  assert.equal(fake.live, 1);
});

test('stream: model error after 2 chunks → failed, chunks delivered, no prompt timing', async () => {
  const runtime = await createRuntime();
  const error = new DOMException('filtered', 'NotReadableError');
  failStream(['a', 'b'], error);
  const stream = runtime.stream('x');
  const seen: string[] = [];
  const e = await rejection((async () => { for await (const c of stream) seen.push(c); })());
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(e.code, 'failed');
  assert.equal(e.cause, error);
  assert.equal(e.timing.prompt, undefined);
  assert.equal(stream.timing, e.timing);
  assert.equal(fake.live, 1);
});

test('stream: abort while the consumer is paused cleans up without another pull', async () => {
  const runtime = await createRuntime({ limit: 1 });
  const ctrl = new AbortController();
  const stream = runtime.stream('x', { signal: ctrl.signal });
  const it = stream[Symbol.asyncIterator]();
  assert.equal((await it.next()).value, 'a');
  ctrl.abort();
  await tick();
  assert.equal(fake.streamSignals[0]!.aborted, true);
  assert.equal(fake.sessions.find((s) => !s.isBase)!.destroyed, true);
  assert.equal(fake.live, 1);
  assert.ok(stream.timing);
  assert.ok(await runtime.run('y')); // slot was released
  const e = await rejection(it.next());
  assert.equal(e.code, 'cancelled');
});

test('stream: late clone after abort is destroyed and never streamed', async () => {
  const runtime = await createRuntime();
  const clone = holdClone('late');
  const ctrl = new AbortController();
  const pending = rejection(runtime.stream('x', { signal: ctrl.signal })[Symbol.asyncIterator]().next());
  await tick();
  ctrl.abort();
  await tick();
  clone.release();
  const e = await pending;
  assert.equal(e.code, 'cancelled');
  assert.equal(typeof e.timing.acquire, 'number');
  assert.equal(fake.streams, 0);
  assert.equal(fake.live, 1);
});

test('stream: shutdown with a paused stream and a queued stream', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const a = runtime.stream('A')[Symbol.asyncIterator]();
  await a.next();
  const b = rejection(runtime.stream('B')[Symbol.asyncIterator]().next());
  await tick();
  await runtime.shutdown();
  assert.equal(fake.live, 0);
  assert.equal(fake.streamSignals[0]!.aborted, true);
  const ea = await rejection(a.next());
  assert.equal(ea.code, 'cancelled');
  assert.equal((ea.cause as Error).name, 'AbortError');
  assert.equal((await b).code, 'closed');
});

test('stream: shutdown while awaiting a chunk resolves only after the clone is destroyed', async () => {
  const runtime = await createRuntime();
  holdStream(['a']);
  const it = runtime.stream('x')[Symbol.asyncIterator]();
  await it.next();
  const pending = rejection(it.next());
  await tick();
  assert.equal(await runtime.shutdown().then(() => fake.live), 0);
  assert.equal((await pending).code, 'cancelled');
});

test('stream: concurrent cleanup triggers (listener + finally) → one destroy, one release', async () => {
  // Known limit: cleanup is synchronous today, so this cannot tell a shared Promise from a
  // boolean guard; it checks there are no duplicate side effects.
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const ctrl = new AbortController();
  const stream = runtime.stream('x', { signal: ctrl.signal });
  const it = stream[Symbol.asyncIterator]();
  await it.next();
  const destroys = fake.destroys;
  ctrl.abort();
  const timing = stream.timing;
  await it.return(undefined);
  assert.equal(fake.destroys - destroys, 1);
  assert.ok(timing);
  assert.equal(stream.timing, timing);
  // Slot released exactly once: one held run occupies it, the next must wait.
  const hold = holdPrompt();
  const clones = fake.clones;
  const r1 = runtime.run('r1');
  const r2 = runtime.run('r2');
  await tick();
  assert.equal(fake.clones - clones, 1);
  hold.release();
  await Promise.all([r1, r2]);
});

test('stream: concurrent cleanup triggers incl. shutdown → clone destroyed once, shutdown resolves', async () => {
  const runtime = await createRuntime();
  const ctrl = new AbortController();
  const it = runtime.stream('x', { signal: ctrl.signal })[Symbol.asyncIterator]();
  await it.next();
  const destroys = fake.destroys;
  ctrl.abort();
  const [ret] = await Promise.all([it.return(undefined), runtime.shutdown()]);
  assert.deepEqual(ret, { value: undefined, done: true });
  assert.equal(fake.destroys - destroys, 2); // clone once + base once
  assert.equal(fake.live, 0);
});

test('stream: completion and cancellation in the same tick → single outcome, single cleanup', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const held = holdStream(['a']);
  const ctrl = new AbortController();
  const it = runtime.stream('x', { signal: ctrl.signal })[Symbol.asyncIterator]();
  await it.next();
  const destroys = fake.destroys;
  const last = it.next().then((r) => (r.done ? 'done' : 'chunk'), (e: TaskError) => e.code);
  held.release();
  ctrl.abort();
  assert.ok(['done', 'cancelled'].includes(await last));
  assert.deepEqual(await it.next(), { value: undefined, done: true });
  assert.equal(fake.destroys - destroys, 1);
  const hold = holdPrompt();
  const clones = fake.clones;
  const r1 = runtime.run('r1');
  const r2 = runtime.run('r2');
  await tick();
  assert.equal(fake.clones - clones, 1);
  hold.release();
  await Promise.all([r1, r2]);
});

test('stream: destroy throwing does not change the outcome, slot still released', async () => {
  const runtime = await createRuntime({ limit: 1 });
  fake.destroyThrows = true;
  assert.deepEqual(await collect(runtime.stream('ok')), ['a', 'b', 'c']);
  assert.ok(await runtime.run('after ok'));
  failStream(['a'], new Error('boom'));
  assert.equal((await rejection(collect(runtime.stream('fail')))).code, 'failed');
  assert.ok(await runtime.run('after fail'));
  holdStream(['a']);
  const ctrl = new AbortController();
  const pending = rejection(collect(runtime.stream('cancel', { signal: ctrl.signal })));
  await tick();
  ctrl.abort();
  assert.equal((await pending).code, 'cancelled');
  assert.ok(await runtime.run('after cancel'));
  await runtime.shutdown();
});

test('stream: clone InvalidStateError → broken; an active stream on its own clone completes', async () => {
  const runtime = await createRuntime({ limit: 2 });
  const held = holdStream(['a1'], ['a2']);
  const a = runtime.stream('A')[Symbol.asyncIterator]();
  assert.equal((await a.next()).value, 'a1');
  failNextClone(new DOMException('gone', 'InvalidStateError'));
  const e = await rejection(collect(runtime.stream('B')));
  assert.equal(e.code, 'broken');
  assert.equal(runtime.state, 'broken');
  held.release();
  assert.equal((await a.next()).value, 'a2');
  assert.equal((await a.next()).done, true);
  assert.equal(fake.live, 1);
});

// US4 — shared limit and queue with run() (T011)

test('stream + run share the limit; slot handoff after destroy; first-pull reject', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const held = holdStream(['a1'], ['a2']);
  const a = runtime.stream('A')[Symbol.asyncIterator]();
  await a.next();
  const b = runtime.run('B');
  await tick();
  assert.equal(fake.clones, 1);
  assert.equal(fake.maxLiveClones, 1);

  const e = await rejection(runtime.stream('C')[Symbol.asyncIterator]().next());
  assert.equal(e.code, 'rejected');
  assert.equal(e.timing.queueWait, undefined);
  assert.equal(fake.clones, 1);

  let clonesAtDestroy = -1;
  fake.onDestroy = () => { clonesAtDestroy = fake.clones; fake.onDestroy = undefined; };
  held.release();
  while (!(await a.next()).done);
  assert.equal(clonesAtDestroy, 1);
  assert.ok((await b).output);
  assert.equal(fake.maxLiveClones, 1);
});

test('stream waiting in the queue: caller abort → cancelled, no clone, listener removed', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const hold = holdPrompt();
  const a = runtime.run('A');
  const ctrl = new AbortController();
  const pending = rejection(runtime.stream('S', { signal: ctrl.signal })[Symbol.asyncIterator]().next());
  await tick();
  assert.equal(getEventListeners(ctrl.signal, 'abort').length, 1);
  ctrl.abort();
  const e = await pending;
  assert.equal(e.code, 'cancelled');
  assert.equal(typeof e.timing.queueWait, 'number');
  assert.equal(fake.clones, 1);
  assert.equal(getEventListeners(ctrl.signal, 'abort').length, 0);
  hold.release();
  await a;
});

test('FIFO follows first pull, not stream creation', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 2 });
  const hold = holdPrompt();
  const a = runtime.run('A');
  const s = runtime.stream('S'); // created first…
  const r = runtime.run('R'); // …but R is queued before S is first pulled
  const sChunks = collect(s);
  await tick();
  hold.release();
  await Promise.all([a, r, sChunks]);
  assert.deepEqual(fake.sessions.filter((x) => !x.isBase).map((x) => x.history.at(-1)), ['A', 'R', 'S']);
});

// Polish — stress validation (T013, T014)

test('100 streams ending every way, then shutdown → no session left (SC-102)', async () => {
  const runtime = await createRuntime({ limit: 4, queueCapacity: 100 });
  let seed = 11;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let i = 0; i < 100; i++) {
    const steps: StreamStep[] = ['a', { hold: sleep(rand() * 4) as Promise<any> }, 'b'];
    if (i % 5 === 4) steps.push({ error: new Error('model failed') });
    fake.streamHooks.push(steps);
  }
  const outcomes = Array.from({ length: 100 }, async (_, i) => {
    const kind = i % 5; // 0 complete, 1 break, 2 abort, 3 timeout, 4 model error
    const ctrl = new AbortController();
    if (kind === 2) setTimeout(() => ctrl.abort(), rand() * 20);
    const signal = kind === 3 ? AbortSignal.timeout(1 + Math.floor(rand() * 10)) : ctrl.signal;
    try {
      for await (const _ of runtime.stream(`s${i}`, { signal })) if (kind === 1) break;
      return 'ok';
    } catch (e) {
      return (e as TaskError).code;
    }
  });
  const settled = Promise.all(outcomes);
  await sleep(15);
  await runtime.shutdown();
  const codes = new Set(await settled);
  assert.ok([...codes].every((c) => ['ok', 'failed', 'cancelled', 'closed'].includes(c)), [...codes].join());
  assert.ok(codes.has('ok') && codes.has('cancelled') && codes.has('failed'), [...codes].join()); // mix exercised
  assert.equal(fake.live, 0);
  assert.equal(fake.destroys, fake.clones + 1);
});

test('burst of 100 mixed run/stream: running never exceeds the limit (SC-104)', async () => {
  const runtime = await createRuntime({ limit: 2, queueCapacity: 4 });
  for (let i = 0; i < 100; i++) fake.promptHooks.push(async () => { await tick(); return 'ok'; });
  const ctrls = Array.from({ length: 100 }, () => new AbortController());
  const tasks = ctrls.map((c, i) =>
    i % 2
      ? runtime.run(`r${i}`, { signal: c.signal }).then(() => 'ok')
      : collect(runtime.stream(`s${i}`, { signal: c.signal })).then(() => 'ok'),
  );
  ctrls[3].abort();
  ctrls[4].abort();
  const results = await Promise.allSettled(tasks);
  const codes = results.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as TaskError).code));
  assert.ok(codes.every((c) => ['ok', 'rejected', 'cancelled'].includes(c)), codes.join());
  assert.ok(fake.maxLiveClones <= 2);
  assert.equal(fake.live, 1);
});

// ===========================================================================
// 003 — runtime snapshot
// ===========================================================================

// US1 — inspect current pressure (T003)

test('snapshot: idle with defaults and explicit config', async () => {
  let runtime = await createRuntime();
  assert.deepEqual(runtime.snapshot(), { state: 'ready', active: 0, queued: 0, limit: 1, queueCapacity: 32 });
  runtime = await createRuntime({ limit: 3, queueCapacity: 7 });
  const s = runtime.snapshot();
  assert.ok(!((s as unknown) instanceof Promise));
  assert.equal(s.limit, 3);
  assert.equal(s.queueCapacity, 7);
});

test('snapshot: independent fresh object per call', async () => {
  const runtime = await createRuntime();
  const a = runtime.snapshot();
  a.active = 99;
  (a as { state: string }).state = 'closed';
  const b = runtime.snapshot();
  assert.notEqual(a, b);
  assert.equal(b.active, 0);
  assert.equal(b.state, 'ready');
  assert.equal(runtime.state, 'ready');
  const hold = holdPrompt();
  const p = runtime.run('x');
  const c = runtime.snapshot();
  assert.equal(b.active, 0);
  assert.equal(c.active, 1);
  hold.release();
  await p;
});

// US2 — counts follow the task lifecycle (T004, T005)

test('snapshot: active follows slot ownership for run and stream', async () => {
  const runtime = await createRuntime({ limit: 2 });
  const hold = holdPrompt();
  const r = runtime.run('r');
  assert.equal(runtime.snapshot().active, 1);
  const held = holdStream(['a'], ['b']);
  const it = runtime.stream('s')[Symbol.asyncIterator]();
  await it.next();
  assert.equal(runtime.snapshot().active, 2); // shared count
  hold.release();
  await r;
  assert.equal(runtime.snapshot().active, 1);
  held.release();
  while (!(await it.next()).done);
  assert.equal(runtime.snapshot().active, 0);
});

test('snapshot: task stays active while its session is being destroyed', async () => {
  const runtime = await createRuntime();
  let during: number | undefined;
  fake.onDestroy = () => { during = runtime.snapshot().active; fake.onDestroy = undefined; };
  await runtime.run('x');
  assert.equal(during, 1);
  assert.equal(runtime.snapshot().active, 0);
});

test('snapshot: paused stream consumer drops out of active on abort without another pull', async () => {
  const runtime = await createRuntime();
  const ctrl = new AbortController();
  const it = runtime.stream('x', { signal: ctrl.signal })[Symbol.asyncIterator]();
  await it.next();
  assert.equal(runtime.snapshot().active, 1);
  ctrl.abort();
  await tick();
  assert.equal(runtime.snapshot().active, 0);
  await rejection(it.next());
});

test('snapshot: queued run and queued stream; lazy stream not counted', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 2 });
  const hold = holdPrompt();
  const a = runtime.run('A');
  const lazy = runtime.stream('lazy');
  assert.deepEqual([runtime.snapshot().active, runtime.snapshot().queued], [1, 0]);
  const b = runtime.run('B');
  assert.equal(runtime.snapshot().queued, 1);
  const s = collect(runtime.stream('S')); // first pull happens now and waits
  assert.equal(runtime.snapshot().queued, 2);
  assert.equal(lazy.timing, undefined);
  hold.release();
  await Promise.all([a, b, s]);
  assert.deepEqual([runtime.snapshot().active, runtime.snapshot().queued], [0, 0]);
});

test('snapshot: capacity rejection not queued; queued cancellation removed immediately', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const hold = holdPrompt();
  const a = runtime.run('A');
  const ctrl = new AbortController();
  const b = rejection(runtime.run('B', { signal: ctrl.signal }));
  const c = rejection(runtime.run('C'));
  assert.equal(runtime.snapshot().queued, 1);
  assert.equal((await c).code, 'rejected');
  assert.equal(runtime.snapshot().queued, 1);
  ctrl.abort();
  assert.equal(runtime.snapshot().queued, 0); // same tick as the abort
  assert.equal((await b).code, 'cancelled');
  hold.release();
  await a;
});

test('snapshot: queued → active handoff is consistent at every deterministic observation', async () => {
  // Invariant: active + queued = tasks whose admission was accepted and that have not yet
  // left the queue or released their slot. Lazy streams and failed admissions never count.
  const runtime = await createRuntime({ limit: 1, queueCapacity: 2 });
  const lazy = runtime.stream('never pulled');
  const hold = holdPrompt();
  let admitted = 0;
  const check = () => {
    const { active, queued } = runtime.snapshot();
    assert.equal(active + queued, admitted);
    assert.ok(active <= 1);
    return { active, queued };
  };
  const a = runtime.run('A'); admitted++;
  check();
  const b = runtime.run('B'); admitted++;
  const c = collect(runtime.stream('C')); admitted++;
  assert.deepEqual(check(), { active: 1, queued: 2 });
  const observed: Array<{ active: number; queued: number }> = [];
  fake.onDestroy = () => observed.push(check()); // A (then B, C) still owns its slot here
  hold.release();
  await a; admitted--;
  assert.deepEqual(check(), { active: 1, queued: 1 }); // B moved to active, C still queued
  await b; admitted--;
  assert.deepEqual(check(), { active: 1, queued: 0 });
  await c; admitted--;
  assert.deepEqual(check(), { active: 0, queued: 0 });
  assert.deepEqual(observed.map((o) => o.active), [1, 1, 1]);
  assert.deepEqual(observed.map((o) => o.queued), [2, 1, 0]);
  assert.equal(lazy.timing, undefined);
});

test('snapshot: saturated — limit 2, 2 held + 5 queued (mixed run/stream)', async () => {
  const runtime = await createRuntime({ limit: 2, queueCapacity: 32 });
  const h1 = holdPrompt();
  const h2 = holdPrompt();
  const tasks = [runtime.run('1'), runtime.run('2')];
  for (let i = 0; i < 5; i++) tasks.push(i % 2 ? runtime.run(`q${i}`) : collect(runtime.stream(`q${i}`)) as Promise<any>);
  assert.deepEqual([runtime.snapshot().active, runtime.snapshot().queued], [2, 5]);
  h1.release();
  h2.release();
  await Promise.all(tasks);
  assert.deepEqual([runtime.snapshot().active, runtime.snapshot().queued], [0, 0]);
});

// US3 — safe in every lifecycle state (T006, T007)

test('snapshot: broken — queued 0, running task stays active, no recovery', async () => {
  const runtime = await createRuntime({ limit: 2, queueCapacity: 1 });
  const hold = holdPrompt('A');
  const a = runtime.run('A');
  await tick();
  failNextClone(new DOMException('gone', 'InvalidStateError'));
  const b = rejection(runtime.run('B'));
  const c = rejection(runtime.run('C'));
  assert.equal(runtime.snapshot().queued, 1);
  assert.equal((await b).code, 'broken');
  const s = runtime.snapshot();
  assert.deepEqual([s.state, s.queued, s.active], ['broken', 0, 1]);
  assert.equal((await c).code, 'broken');
  const creates = fake.creates;
  for (let i = 0; i < 10; i++) runtime.snapshot();
  assert.equal(fake.creates, creates);
  hold.release();
  await a;
  assert.deepEqual([runtime.snapshot().state, runtime.snapshot().active], ['broken', 0]);
});

test('snapshot: shutdown in progress vs completed', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  holdPrompt();
  const a = rejection(runtime.run('A'));
  const b = rejection(runtime.run('B'));
  const closing = runtime.shutdown();
  assert.deepEqual(runtime.snapshot(), { state: 'closed', active: 1, queued: 0, limit: 1, queueCapacity: 1 });
  await closing;
  assert.deepEqual(runtime.snapshot(), { state: 'closed', active: 0, queued: 0, limit: 1, queueCapacity: 1 });
  await Promise.all([a, b]);
});

test('snapshot: shutdown with a paused stream reaches 0 active', async () => {
  const runtime = await createRuntime();
  const it = runtime.stream('x')[Symbol.asyncIterator]();
  await it.next();
  assert.equal(runtime.snapshot().active, 1);
  await runtime.shutdown();
  assert.deepEqual([runtime.snapshot().state, runtime.snapshot().active, runtime.snapshot().queued], ['closed', 0, 0]);
  await rejection(it.next());
});

// Polish — bound and side-effect validation (T008, T009)

test('snapshot: 100 mixed tasks never exceed limit or queue capacity (SC-203)', async () => {
  const runtime = await createRuntime({ limit: 2, queueCapacity: 4 });
  for (let i = 0; i < 100; i++) {
    fake.promptHooks.push(async () => { await tick(); return 'ok'; });
    fake.streamHooks.push(['a', { hold: tick() as Promise<any> }, 'b']);
  }
  let peak = 0;
  const bound = () => {
    const { active, queued } = runtime.snapshot();
    assert.ok(active <= 2 && queued <= 4, `active=${active} queued=${queued}`);
    peak = Math.max(peak, active + queued);
  };
  const ctrls = Array.from({ length: 100 }, () => new AbortController());
  const tasks = ctrls.map((c, i) => {
    const p = i % 2
      ? runtime.run(`r${i}`, { signal: c.signal })
      : collect(runtime.stream(`s${i}`, { signal: c.signal }));
    return p.then(bound, bound);
  });
  bound();
  ctrls[3].abort();
  ctrls[4].abort();
  bound();
  await Promise.all(tasks);
  assert.equal(peak, 6); // the burst really saturated limit + queue
  assert.deepEqual([runtime.snapshot().active, runtime.snapshot().queued], [0, 0]);
});

test('snapshot: 10,000 reads have no side effects (SC-204; not a benchmark)', async () => {
  const runtime = await createRuntime({ limit: 1, queueCapacity: 1 });
  const hold = holdPrompt();
  const a = runtime.run('A');
  const b = runtime.run('B');
  const before = { creates: fake.creates, clones: fake.clones, destroys: fake.destroys, state: runtime.state };
  const snap = runtime.snapshot();
  for (let i = 0; i < 10_000; i++) runtime.snapshot();
  assert.deepEqual({ creates: fake.creates, clones: fake.clones, destroys: fake.destroys, state: runtime.state }, before);
  assert.deepEqual(runtime.snapshot(), snap);
  hold.release();
  await Promise.all([a, b]);
  assert.ok((await runtime.run('after')).output);
});

// ===========================================================================
// 004 — named session templates
// ===========================================================================

const bases = () => fake.sessions.filter((s) => s.isBase);
const clonesOf = () => fake.sessions.filter((s) => !s.isBase);
const TEMPLATES = {
  momentum: { initialPrompts: ['momentum'] },
  risk: { initialPrompts: ['risk'] },
};

// US1 — run tasks against a chosen template (T003)

test('templates: each task clones only its template; bases unchanged', async () => {
  const runtime = await createRuntime({ templates: TEMPLATES });
  assert.deepEqual(bases().map((b) => b.history), [['momentum'], ['risk']]);
  await runtime.run('m1', { template: 'momentum' });
  await runtime.run('r1', { template: 'risk' });
  await collect(runtime.stream('r2', { template: 'risk' }));
  assert.deepEqual(clonesOf().map((c) => c.history), [['momentum', 'm1'], ['risk', 'r1'], ['risk', 'r2']]);
  assert.deepEqual(bases().map((b) => b.history), [['momentum'], ['risk']]);
  assert.ok(bases().every((b) => b.prompts === 0));
});

// US2 — shared scheduler (T004)

test('templates: one limit and one queue shared across templates', async () => {
  let runtime = await createRuntime({ templates: { ...TEMPLATES, summary: { initialPrompts: ['summary'] } }, limit: 1 });
  const hold = holdPrompt();
  const m = runtime.run('m', { template: 'momentum' });
  const r = runtime.run('r', { template: 'risk' });
  assert.deepEqual(runtime.snapshot(), { state: 'ready', active: 1, queued: 1, limit: 1, queueCapacity: 32 });
  hold.release();
  await Promise.all([m, r]);

  runtime = await createRuntime({ templates: { ...TEMPLATES, summary: { initialPrompts: ['summary'] } }, limit: 2 });
  const h1 = holdPrompt();
  const h2 = holdPrompt();
  const tasks = [
    runtime.run('a', { template: 'momentum' }),
    runtime.run('b', { template: 'risk' }),
    runtime.run('c', { template: 'summary' }),
  ];
  assert.deepEqual([runtime.snapshot().active, runtime.snapshot().queued], [2, 1]);
  h1.release();
  h2.release();
  await Promise.all(tasks);
});

test('templates: FIFO across templates; lazy named stream consumes nothing', async () => {
  const runtime = await createRuntime({ templates: { ...TEMPLATES, summary: { initialPrompts: ['summary'] } }, limit: 1, queueCapacity: 3 });
  const lazy = runtime.stream('x', { template: 'risk' });
  const hold = holdPrompt();
  const first = runtime.run('first', { template: 'momentum' });
  const clonesBefore = fake.clones;
  const order = [
    runtime.run('1', { template: 'risk' }),
    runtime.run('2', { template: 'momentum' }),
    runtime.run('3', { template: 'summary' }),
  ];
  assert.equal(fake.clones, clonesBefore);
  assert.deepEqual([runtime.snapshot().active, runtime.snapshot().queued], [1, 3]);
  hold.release();
  await Promise.all([first, ...order]);
  assert.deepEqual(clonesOf().slice(1).map((c) => c.history[0]), ['risk', 'momentum', 'summary']);
  assert.equal(lazy.timing, undefined);
  assert.equal(fake.streams, 0);
});

// US3 — invalid template selection (T005)

test('templates: unknown or missing template → TypeError, nothing consumed', async () => {
  const runtime = await createRuntime({ templates: TEMPLATES });
  const hold = holdPrompt();
  const running = runtime.run('ok', { template: 'momentum' });
  await tick(); // let the running task finish cloning before taking the baseline
  const before = { clones: fake.clones, creates: fake.creates, snap: runtime.snapshot() };
  const unchanged = () => {
    assert.equal(fake.clones, before.clones);
    assert.equal(fake.creates, before.creates);
    assert.deepEqual(runtime.snapshot(), before.snap);
  };

  const e1 = await runtime.run('x', { template: 'nope' }).catch((e) => e);
  assert.ok(e1 instanceof TypeError && !(e1 instanceof TaskError));
  unchanged();

  const stream = runtime.stream('x', { template: 'nope' });
  unchanged();
  await assert.rejects(stream[Symbol.asyncIterator]().next(), TypeError);
  assert.equal(stream.timing, undefined);
  unchanged();

  await assert.rejects(runtime.run('x'), TypeError); // no default, no automatic choice
  await assert.rejects(runtime.stream('x')[Symbol.asyncIterator]().next(), TypeError);
  unchanged();

  hold.release();
  await running;
});

// US4 — existing single-session usage (T006)

test('templates: existing createRuntime() / { session } unchanged', async () => {
  let runtime = await createRuntime();
  assert.equal(fake.creates, 1);
  assert.equal(bases().length, 1);
  assert.ok((await runtime.run('x')).output);
  holdPrompt();
  const ctrl = new AbortController();
  const p = rejection(runtime.run('y', { signal: ctrl.signal }));
  await tick();
  ctrl.abort();
  assert.equal((await p).code, 'cancelled');

  const session = { initialPrompts: ['sys'] };
  runtime = await createRuntime({ session });
  assert.equal(fake.createArgs.at(-1), session);
  assert.ok(await collect(runtime.stream('z')));
});

test('templates: session + templates → unnamed uses default, named uses template', async () => {
  const runtime = await createRuntime({ session: { initialPrompts: ['default'] }, templates: { risk: { initialPrompts: ['risk'] } } });
  assert.equal(bases().length, 2);
  await runtime.run('a');
  await runtime.run('b', { template: 'risk' });
  await collect(runtime.stream('c'));
  assert.deepEqual(clonesOf().map((c) => c.history), [['default', 'a'], ['risk', 'b'], ['default', 'c']]);
});

test('templates: empty templates → TypeError without session, single-session with session', async () => {
  await assert.rejects(createRuntime({ templates: {} }), TypeError);
  assert.equal(fake.creates, 0);
  const runtime = await createRuntime({ session: { initialPrompts: ['s'] }, templates: {} });
  assert.equal(bases().length, 1);
  await runtime.run('x');
  assert.deepEqual(clonesOf()[0].history, ['s', 'x']);
});

// US5 — lifecycle for all bases (T007–T009)

function failCreateOn(n: number, error: unknown) {
  const create = provider.create;
  let calls = 0;
  provider.create = async (options: unknown) => {
    if (++calls === n) throw error;
    return create(options);
  };
}

test('templates: partial creation rolls back created bases and rethrows the original error', async () => {
  const err = new DOMException('no model', 'NotAllowedError');
  failCreateOn(3, err);
  await assert.rejects(createRuntime({ templates: { a: {}, b: {}, c: {} } }), (e) => e === err);
  assert.equal(fake.destroys, 2);
  assert.equal(fake.live, 0);
});

test('templates: rollback includes the default base and continues past destroy failures', async () => {
  const err = new Error('create failed');
  failCreateOn(3, err);
  fake.destroyThrows = true;
  await assert.rejects(createRuntime({ session: {}, templates: { a: {}, b: {} } }), (e) => e === err);
  assert.equal(fake.destroys, 2);
  assert.ok(bases().every((b) => b.destroyed));
  assert.equal(fake.live, 0);
});

test('templates: broken is runtime-wide; running task on another template completes', async () => {
  const runtime = await createRuntime({ templates: { a: { initialPrompts: ['a'] }, b: { initialPrompts: ['b'] } }, limit: 2, queueCapacity: 2 });
  const hold = holdPrompt('b done');
  const heldB = runtime.run('held', { template: 'b' });
  await tick();
  failNextClone(new DOMException('gone', 'InvalidStateError'));
  const a = rejection(runtime.run('a', { template: 'a' }));
  const queuedB = rejection(runtime.run('queued', { template: 'b' }));
  assert.equal((await a).code, 'broken');
  assert.equal(runtime.state, 'broken');
  assert.equal((await queuedB).code, 'broken');
  const clones = fake.clones;
  assert.equal((await rejection(runtime.run('x', { template: 'a' }))).code, 'broken');
  assert.equal((await rejection(runtime.run('y', { template: 'b' }))).code, 'broken');
  assert.equal(fake.clones, clones);
  assert.deepEqual(runtime.snapshot(), { state: 'broken', active: 1, queued: 0, limit: 2, queueCapacity: 2 });
  const creates = fake.creates;
  hold.release();
  assert.equal((await heldB).output, 'b done');
  assert.equal(fake.creates, creates);
});

test('templates: shutdown destroys every base exactly once', async () => {
  let runtime = await createRuntime({ session: {}, templates: { a: {}, b: {} } });
  await runtime.run('x', { template: 'a' });
  await runtime.run('y', { template: 'b' });
  const s1 = runtime.shutdown();
  const s2 = runtime.shutdown();
  assert.equal(s1, s2);
  await Promise.all([s1, s2]);
  assert.equal(fake.destroys, fake.clones + 3);
  assert.ok(bases().every((b) => b.destroyed));
  assert.equal(fake.live, 0);
  const destroys = fake.destroys;
  await runtime.shutdown();
  assert.equal(fake.destroys, destroys);

  runtime = await createRuntime({ templates: { a: {}, b: {}, c: {} } });
  fake.destroyThrows = true;
  await runtime.shutdown();
  assert.ok(bases().every((b) => b.destroyed));
  assert.equal(fake.live, 0);
});

test('templates: shutdown cancels a running task and destroys its clone before any base', async () => {
  const runtime = await createRuntime({ templates: { a: {}, b: {} } });
  holdPrompt();
  const p = rejection(runtime.run('x', { template: 'a' }));
  await tick();
  let basesAliveAtFirstDestroy: boolean | undefined;
  fake.onDestroy = () => {
    basesAliveAtFirstDestroy ??= bases().every((b) => !b.destroyed);
  };
  await runtime.shutdown();
  assert.equal((await p).code, 'cancelled');
  assert.equal(basesAliveAtFirstDestroy, true);
  assert.equal(fake.live, 0);
});

// Polish — mixed-template bound validation (T010; not a benchmark)

test('templates: 100 mixed run/stream tasks across 3 templates stay within global bounds (SC-303)', async () => {
  const runtime = await createRuntime({ templates: { a: {}, b: {}, c: {} }, limit: 2, queueCapacity: 4 });
  for (let i = 0; i < 100; i++) {
    fake.promptHooks.push(async () => { await tick(); return 'ok'; });
    fake.streamHooks.push(['x', { hold: tick() as Promise<any> }, 'y']);
  }
  let peak = 0;
  const bound = () => {
    const s = runtime.snapshot();
    assert.deepEqual(Object.keys(s).sort(), ['active', 'limit', 'queueCapacity', 'queued', 'state']);
    assert.ok(s.active <= 2 && s.queued <= 4, `active=${s.active} queued=${s.queued}`);
    peak = Math.max(peak, s.active + s.queued);
  };
  const names = ['a', 'b', 'c'];
  const ctrls = Array.from({ length: 100 }, () => new AbortController());
  const outcomes = ctrls.map((c, i) => {
    const options = { signal: c.signal, template: names[i % 3] };
    const p = i % 2 ? runtime.run(`r${i}`, options).then(() => 'ok') : collect(runtime.stream(`s${i}`, options)).then(() => 'ok');
    return p.then(
      (v) => { bound(); return v; },
      (e: TaskError) => { bound(); return e.code; },
    );
  });
  bound();
  ctrls[3].abort();
  ctrls[4].abort();
  const codes = await Promise.all(outcomes);
  assert.ok(codes.every((c) => ['ok', 'rejected', 'cancelled'].includes(c)), codes.join());
  assert.equal(peak, 6);
  assert.deepEqual([runtime.snapshot().active, runtime.snapshot().queued], [0, 0]);
});

// ---------------------------------------------------------------------------
// 007 — provider seam: clone-less provider, broken delegation, async cleanup (T006–T011)
// ---------------------------------------------------------------------------

type Base = { tag?: string; hold?: boolean };
/** Request-style provider: base = template config, one task object per task, no clone.
 *  Owns no per-template or provider-wide resource, so it has neither destroy nor close. */
function requestProvider() {
  const tasks: { destroyed: number }[] = [];
  const provider = {
    starts: [] as Base[],
    create: async (config: Base = {}) => config,
    async start(base: Base) {
      provider.starts.push(base);
      const task = {
        destroyed: 0,
        async prompt(input: unknown, { signal }: { signal: AbortSignal }) {
          if (base.hold) {
            await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
          }
          return `${base.tag}:${input}`;
        },
        async *promptStreaming(_input: unknown, { signal }: { signal: AbortSignal }) {
          for (const c of ['a', 'b', 'c']) {
            if (signal.aborted) throw signal.reason;
            yield c;
          }
        },
        destroy() { task.destroyed++; },
      };
      tasks.push(task);
      return task;
    },
    broken: () => false,
  };
  return { provider, tasks };
}

test('clone-less provider: run and stream on the selected template base', async () => {
  const { provider, tasks } = requestProvider();
  const a = { tag: 'A' }, b = { tag: 'B' };
  const runtime = await createCoreRuntime(provider, { templates: { a, b } });
  assert.equal((await runtime.run('x', { template: 'a' })).output, 'A:x');
  assert.equal(provider.starts[0], a);
  assert.deepEqual(await collect(runtime.stream('y', { template: 'b' })), ['a', 'b', 'c']);
  assert.equal(provider.starts[1], b);
  assert.deepEqual(tasks.map((t) => t.destroyed), [1, 1]);
  await runtime.shutdown();
  assert.ok(!('clone' in provider));
  assert.ok(tasks.every((t) => !('clone' in t)));
});

test('clone-less provider: caller abort, early break, shutdown', async () => {
  const { provider, tasks } = requestProvider();
  const runtime = await createCoreRuntime(provider, { templates: { held: { tag: 'H', hold: true }, s: { tag: 'S' } } });
  const ctrl = new AbortController();
  const p = runtime.run('x', { signal: ctrl.signal, template: 'held' });
  await tick();
  ctrl.abort();
  assert.equal((await rejection(p)).code, 'cancelled');
  const it = runtime.stream('y', { template: 's' })[Symbol.asyncIterator]();
  await it.next();
  await it.return(undefined);
  assert.equal(tasks[1].destroyed, 1); // destroyed before the loop exit completed
  await runtime.shutdown();
  assert.equal(runtime.state, 'closed');
});

test('broken is delegated to provider.broken, consulted only for start rejections', async () => {
  const err = new Error('resource gone');
  let consulted = 0;
  let failStart = false;
  const gate = deferred<string>();
  const provider = {
    create: async (config: Base = {}) => config,
    async start() {
      if (failStart) throw err;
      return { prompt: () => gate.promise, promptStreaming: async function* () {}, destroy() {} };
    },
    broken: (e: unknown) => { consulted++; return e === err; },
  };
  const runtime = await createCoreRuntime(provider, { limit: 1, queueCapacity: 2 });
  const a = runtime.run('a');
  await tick();
  failStart = true;
  const b = runtime.run('b');
  const c = runtime.run('c');
  gate.resolve('A');
  assert.equal((await a).output, 'A');
  const eb = await rejection(b);
  assert.equal(eb.code, 'broken');
  assert.equal(eb.cause, err);
  assert.equal((await rejection(c)).code, 'broken');
  assert.equal(runtime.state, 'broken');
  assert.equal((await rejection(runtime.run('d'))).code, 'broken');
  assert.equal(consulted, 1);
});

test('broken is not consulted when the task was aborted or when prompt fails', async () => {
  const err = new Error('x');
  let consulted = 0;
  const startGate = deferred();
  let mode: 'slow-reject' | 'prompt-reject' = 'slow-reject';
  const provider = {
    create: async (config: Base = {}) => config,
    async start() {
      if (mode === 'slow-reject') { await startGate.promise; throw err; }
      return { prompt: async () => { throw err; }, promptStreaming: async function* () {}, destroy() {} };
    },
    broken: () => { consulted++; return true; },
  };
  const runtime = await createCoreRuntime(provider);
  const ctrl = new AbortController();
  const p = runtime.run('x', { signal: ctrl.signal });
  await tick();
  ctrl.abort();
  startGate.resolve();
  assert.equal((await rejection(p)).code, 'cancelled');
  mode = 'prompt-reject';
  const e = await rejection(runtime.run('y'));
  assert.equal(e.code, 'failed');
  assert.equal(runtime.state, 'ready');
  assert.equal(consulted, 0);
});

/** Provider with async task destroy (test-released), async base destroy, async close. */
function asyncCleanupProvider(events: string[]) {
  const taskDestroy = deferred();
  const provider = {
    closes: 0,
    create: async (config: Base = {}) => config,
    async start() {
      return {
        prompt: (_: unknown, { signal }: { signal: AbortSignal }) =>
          new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
        promptStreaming: async function* () {},
        destroy() {
          events.push('task-destroy-start');
          return taskDestroy.promise.then(() => { events.push('task-destroy-end'); });
        },
      };
    },
    broken: () => false,
    async destroy(base: Base) { await tick(); events.push(`base-destroy:${base.tag}`); },
    async close() { provider.closes++; await tick(); events.push('close'); },
  };
  return { provider, releaseTaskDestroy: () => taskDestroy.resolve() };
}

test('shutdown awaits async task cleanup, then base cleanup, then close', async () => {
  const events: string[] = [];
  const { provider, releaseTaskDestroy } = asyncCleanupProvider(events);
  const runtime = await createCoreRuntime(provider, { templates: { a: { tag: 'a' }, b: { tag: 'b' } } });
  const run = track(runtime.run('x', { template: 'a' }));
  await tick();
  const shutdown = runtime.shutdown().then(() => { events.push('shutdown'); });
  await tick();
  assert.deepEqual(events, ['task-destroy-start']);
  assert.equal(runtime.snapshot().active, 1); // slot held until the async destroy settles
  assert.equal(run.settled, false); // cleanup before settle
  releaseTaskDestroy();
  await shutdown;
  assert.deepEqual(events, ['task-destroy-start', 'task-destroy-end', 'base-destroy:a', 'base-destroy:b', 'close', 'shutdown']);
  assert.equal((await rejection(run.promise)).code, 'cancelled');
  assert.equal(provider.closes, 1);
});

test('async rollback: every created base destroyed, original error rethrown, no close', async () => {
  const err = new Error('create c failed');
  const destroyed: string[] = [];
  let closes = 0;
  const provider = {
    async create(config: Base = {}) { if (config.tag === 'c') throw err; return config; },
    async start(): Promise<never> { throw new Error('unused'); },
    broken: () => false,
    async destroy(base: Base) {
      await tick();
      destroyed.push(base.tag!);
      if (base.tag === 'b') throw new Error('destroy b failed');
    },
    async close() { closes++; },
  };
  await assert.rejects(
    createCoreRuntime(provider, { templates: { a: { tag: 'a' }, b: { tag: 'b' }, c: { tag: 'c' } } }),
    (e) => e === err,
  );
  assert.deepEqual(destroyed, ['a', 'b']);
  assert.equal(closes, 0);
});

test('shutdown: close runs once for concurrent calls and after rejecting cleanups', async () => {
  const events: string[] = [];
  let closes = 0;
  const provider = {
    create: async (config: Base = {}) => config,
    async start(): Promise<never> { throw new Error('unused'); },
    broken: () => false,
    async destroy() { events.push('destroy'); throw new Error('destroy failed'); },
    async close() { closes++; events.push('close'); throw new Error('close failed'); },
  };
  const runtime = await createCoreRuntime(provider);
  const [s1, s2] = [runtime.shutdown(), runtime.shutdown()];
  assert.equal(s1, s2);
  await Promise.all([s1, s2]);
  assert.equal(runtime.shutdown(), s1);
  assert.equal(closes, 1);
  assert.deepEqual(events, ['destroy', 'close']);
});
