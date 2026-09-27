import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebLLMRuntime, type WebLLMEngine } from '../src/webllm/runtime.ts';

// Fake engine reproducing WebLLM 0.2.85 as observed in experiments/webllm (E3–E7b):
// - the per-model lock is taken in create() and released only after the generator's last
//   statement, so a native return() leaks it (E6);
// - the engine-wide interrupt flag is reset on the first next() of a stream (line 536) and ends a
//   generation with finish_reason "abort" and no error (E5, E8);
// - a non-streaming request throws here, so any use of that path fails the test.
// The first token waits on a test-released gate: deterministic, no wall-clock sleeps.

const tick = () => new Promise((r) => setImmediate(r));
const named = (name: string) => Object.assign(new Error(name), { name });
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function fakeEngine(chunks = ['a', 'b', 'c']) {
  const e = {
    loaded: true, flag: false, lock: false, waiters: [] as (() => void)[],
    holders: 0, maxHolders: 0, requests: [] as any[], returns: 0, unloads: 0,
    events: [] as string[],
    createGate: undefined as Promise<void> | undefined,
    firstToken: undefined as Promise<void> | undefined,
    failWith: undefined as Error | undefined,
  };
  const acquire = async () => {
    if (e.lock) await new Promise<void>((r) => e.waiters.push(r));
    e.lock = true;
    e.maxHolders = Math.max(e.maxHolders, ++e.holders);
  };
  const release = () => {
    e.holders--;
    const next = e.waiters.shift();
    if (next) next(); else e.lock = false;
  };
  const engine: WebLLMEngine = {
    chat: {
      completions: {
        async create(request: any) {
          if (!request.stream) throw new Error('non-streaming path used');
          if (!e.loaded) throw named('ModelNotLoadedError');
          if (e.createGate) await e.createGate;
          e.requests.push(request);
          await acquire();
          const gen = (async function* () {
            e.flag = false;
            e.events.push('reset');
            if (e.firstToken) await e.firstToken;
            let aborted = false;
            for (const content of chunks) {
              if (e.flag) { aborted = true; break; }
              if (e.failWith) { const f = e.failWith; e.failWith = undefined; release(); throw f; }
              await tick();
              yield { choices: [{ delta: { content } }] };
            }
            yield { choices: [{ delta: {}, finish_reason: aborted ? 'abort' : 'stop' }] };
            e.events.push('generation-end');
            release(); // after the last yield only: a return() never gets here
          })();
          return {
            [Symbol.asyncIterator]() { return this; },
            next: () => gen.next(),
            return: (v?: unknown) => { e.returns++; return gen.return(v as undefined); },
          } as any;
        },
      },
    },
    async interruptGenerate() { e.flag = true; e.events.push('interrupt'); },
    async getMessage() { if (!e.loaded) throw named('ModelNotLoadedError'); return ''; },
    async unload() {
      e.events.push('unload-start');
      await tick();
      e.loaded = false;
      e.unloads++;
      e.events.push('unload-end');
    },
  };
  return { e, engine };
}

const code = (p: Promise<unknown>) => p.then(() => 'ok', (err) => err.code ?? err.name);

test('limit > 1 is rejected before any engine work; the engine is not unloaded', async () => {
  const { e, engine } = fakeEngine();
  await assert.rejects(createWebLLMRuntime(engine, { limit: 2 }), TypeError);
  assert.equal(e.unloads, 0);
  assert.equal(e.requests.length, 0);
});

test('two runs are serialized in AkariSP, never inside the engine (E3)', async () => {
  const { e, engine } = fakeEngine();
  const gate = deferred();
  e.firstToken = gate.promise;
  const runtime = await createWebLLMRuntime(engine, { queueCapacity: 1 });
  const a = runtime.run('A');
  const b = runtime.run('B');
  await tick();
  assert.deepEqual(runtime.snapshot(), { state: 'ready', active: 1, queued: 1, limit: 1, queueCapacity: 1 });
  assert.equal(e.requests.length, 1);
  gate.resolve();
  assert.equal((await a).output, 'abc');
  assert.equal((await b).output, 'abc');
  assert.equal(e.maxHolders, 1);
  await runtime.shutdown();
});

test('aborting a queued task never reaches the engine; the running task completes (E4)', async () => {
  const { e, engine } = fakeEngine();
  const gate = deferred();
  e.firstToken = gate.promise;
  const runtime = await createWebLLMRuntime(engine, { queueCapacity: 1 });
  const a = runtime.run('A');
  const ctrl = new AbortController();
  const b = code(runtime.run('B', { signal: ctrl.signal }));
  await tick();
  ctrl.abort();
  assert.equal(await b, 'cancelled');
  gate.resolve();
  assert.equal((await a).output, 'abc');
  assert.equal(e.requests.length, 1);
  assert.ok(!e.events.includes('interrupt'));
  await runtime.shutdown();
});

test('aborting an active run interrupts and drains; the next run is normal (E5, E6b)', async () => {
  const { e, engine } = fakeEngine(['a', 'b', 'c', 'd', 'e', 'f']);
  const runtime = await createWebLLMRuntime(engine);
  const ctrl = new AbortController();
  const a = code(runtime.run('A', { signal: ctrl.signal }));
  await tick(); await tick();
  ctrl.abort();
  assert.equal(await a, 'cancelled');
  assert.equal((await runtime.run('N')).output, 'abcdef');
  assert.equal(e.returns, 0);
  await runtime.shutdown();
});

test('early break of a stream drains the native stream; the next run is normal (E6)', async () => {
  const { e, engine } = fakeEngine(['a', 'b', 'c', 'd']);
  const runtime = await createWebLLMRuntime(engine);
  for await (const chunk of runtime.stream('A')) {
    assert.equal(chunk, 'a');
    break;
  }
  assert.equal((await runtime.run('N')).output, 'abcd');
  assert.equal(e.returns, 0);
  assert.ok(e.events.includes('interrupt'));
  await runtime.shutdown();
});

test('cancelled before the first next(): first next, then interrupt, then drain (M1a)', async () => {
  const { e, engine } = fakeEngine();
  const createGate = deferred();
  const firstToken = deferred();
  e.createGate = createGate.promise;
  e.firstToken = firstToken.promise;
  const runtime = await createWebLLMRuntime(engine);
  const ctrl = new AbortController();
  const a = code(runtime.run('A', { signal: ctrl.signal }));
  await tick();
  ctrl.abort(); // create() still pending: the adapter never pulls
  e.createGate = undefined;
  createGate.resolve();
  await tick(); await tick();
  firstToken.resolve();
  assert.equal(await a, 'cancelled');
  const reset = e.events.indexOf('reset');
  assert.ok(e.events.lastIndexOf('interrupt') > reset && reset >= 0, e.events.join());
  e.firstToken = undefined;
  assert.equal((await runtime.run('N')).output, 'abc');
  assert.equal(e.returns, 0);
  await runtime.shutdown();
});

for (const cause of ['abort', 'timeout', 'shutdown'] as const) {
  test(`cancelled while the first token is pending (${cause}): interrupt, drain, lock released (M1b)`, async () => {
    const { e, engine } = fakeEngine();
    const firstToken = deferred();
    e.firstToken = firstToken.promise;
    const runtime = await createWebLLMRuntime(engine);
    const ctrl = new AbortController();
    const signal = cause === 'timeout' ? AbortSignal.timeout(5) : ctrl.signal;
    const a = code(runtime.run('A', { signal }));
    await tick();
    assert.ok(e.events.includes('reset')); // first next() is pending on the gate
    const shutdown = cause === 'shutdown' ? runtime.shutdown() : undefined;
    if (cause === 'abort') ctrl.abort();
    if (cause === 'timeout') await new Promise((r) => setTimeout(r, 20));
    firstToken.resolve();
    assert.equal(await a, 'cancelled');
    assert.equal(e.returns, 0);
    if (shutdown) {
      await shutdown;
      assert.ok(e.events.indexOf('generation-end') < e.events.indexOf('unload-start'));
      return;
    }
    e.firstToken = undefined;
    assert.equal((await runtime.run('N')).output, 'abc');
    assert.equal(e.lock, false);
    await runtime.shutdown();
  });
}

test('paused consumer abort: drain while the adapter is suspended, slot released (M2)', async () => {
  const { e, engine } = fakeEngine(['a', 'b', 'c', 'd']);
  const runtime = await createWebLLMRuntime(engine);
  const ctrl = new AbortController();
  const it = runtime.stream('A', { signal: ctrl.signal })[Symbol.asyncIterator]();
  assert.deepEqual(await it.next(), { value: 'a', done: false });
  ctrl.abort(); // consumer is not pulling
  assert.equal((await runtime.run('N')).output, 'abcd'); // admitted: the slot was released
  assert.equal(await code(it.next()), 'cancelled');
  assert.equal(e.returns, 0);
  await runtime.shutdown();
});

test('shutdown with an active stream: drain, then unload once, then resolve (E7, E7b)', async () => {
  const { e, engine } = fakeEngine(['a', 'b', 'c', 'd']);
  const runtime = await createWebLLMRuntime(engine, { templates: { x: {}, y: {} } });
  const it = runtime.stream('A', { template: 'x' })[Symbol.asyncIterator]();
  await it.next();
  await runtime.shutdown();
  assert.ok(e.events.indexOf('generation-end') < e.events.indexOf('unload-start'), e.events.join());
  assert.equal(e.unloads, 1); // one engine, whatever the template count
  assert.equal(e.events.at(-1), 'unload-end');
  assert.equal(await code(it.next()), 'cancelled');
  assert.equal(e.returns, 0);
});

test('an unloaded engine makes the runtime broken at task start (E7, E8)', async () => {
  const { e, engine } = fakeEngine();
  const runtime = await createWebLLMRuntime(engine);
  await engine.unload();
  await assert.rejects(runtime.run('A'), (err: any) => err.code === 'broken' && err.cause.name === 'ModelNotLoadedError');
  assert.equal(runtime.state, 'broken');
  assert.equal(await code(runtime.run('B')), 'broken');
  assert.equal(e.requests.length, 0);
});

for (const name of ['NonNegativeError', 'DeviceLostError']) {
  test(`${name} during generation fails only that task (no execution-stage promotion)`, async () => {
    const { e, engine } = fakeEngine();
    const runtime = await createWebLLMRuntime(engine);
    e.failWith = named(name);
    await assert.rejects(runtime.run('A'), (err: any) => err.code === 'failed' && err.cause.name === name);
    assert.equal(runtime.state, 'ready');
    assert.equal((await runtime.run('B')).output, 'abc');
    await runtime.shutdown();
  });
}

test('templates build each request from their own config on one engine (E9)', async () => {
  const { e, engine } = fakeEngine();
  const sysR = { role: 'system', content: 'risk' };
  const sysD = { role: 'system', content: 'default' };
  const runtime = await createWebLLMRuntime(engine, {
    templates: { risk: { initialPrompts: [sysR], temperature: 0 }, default: { initialPrompts: [sysD] } },
  });
  for (const t of ['risk', 'default', 'risk']) await runtime.run(`q-${t}`, { template: t });
  assert.deepEqual(e.requests.map((r) => [r.messages[0].content, r.messages.at(-1).content, r.temperature]), [
    ['risk', 'q-risk', 0], ['default', 'q-default', undefined], ['risk', 'q-risk', 0],
  ]);
  await assert.rejects(runtime.run('x', { template: 'nope' }), TypeError);
  assert.equal(e.requests.length, 3);
  await runtime.shutdown();
  assert.equal(e.unloads, 1);
});

test('the WebLLM integration has no clone', () => {
  const code = readFileSync(new URL('../src/webllm/runtime.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bclone\b/);
});
