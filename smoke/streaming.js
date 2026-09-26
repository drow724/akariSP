// Manual smoke test: real Chrome LanguageModel through AkariSP streaming.
// Lifecycle only: no output-quality checks, no performance claims, no model download.
import { createRuntime, TaskError } from '../dist/index.js';

const SESSION = {
  initialPrompts: [{ role: 'system', content: 'You are a helpful assistant.' }],
};
const SHORT_PROMPT = 'Reply with OK.';
const LONG_PROMPT = 'Explain Java virtual threads in detail with many examples and multiple sections.';
const TEST_TIMEOUT_MS = 120_000; // harness watchdog per test, not AkariSP behavior
const SHUTDOWN_TIMEOUT_MS = 15_000;

const $ = (id) => document.getElementById(id);
let currentRuntime;
setInterval(() => { $('state').textContent = currentRuntime ? currentRuntime.state : '–'; }, 200);

function log(...parts) {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${parts.join(' ')}`;
  $('log').textContent += line + '\n';
  console.log(line);
}

class SmokeFailure extends Error {
  constructor(label, expected, actual) {
    super(`${label}\nExpected ${expected}\nActual: ${actual}`);
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SmokeFailure(label, `completion within ${ms} ms`, 'still pending')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const describe = (e) =>
  e instanceof TaskError
    ? `TaskError(code=${e.code}, cause.name=${e.cause?.name}, cause.message=${e.cause?.message})`
    : `${e?.name}: ${e?.message}`;

/** Per-test context: records result lines, creates runtimes that are always shut down. */
function context() {
  const lines = [];
  const runtimes = [];
  return {
    lines,
    runtimes,
    note(text) { lines.push(text); log(text); },
    check(label, ok, expected, actual) {
      log(`${ok ? 'ok  ' : 'FAIL'} ${label} (expected ${expected}; actual ${actual})`);
      if (!ok) throw new SmokeFailure(label, expected, actual);
    },
    async runtime(options = {}) {
      const rt = await createRuntime({ session: SESSION, ...options });
      runtimes.push(rt);
      currentRuntime = rt;
      return rt;
    },
    chunk(c) { $('chunks').textContent += c; },
  };
}

/** Consumes a stream; returns { chunks, error } instead of throwing. */
async function consume(stream, ctx, { breakAfter, onChunk } = {}) {
  const chunks = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      ctx.chunk(chunk);
      onChunk?.(chunks.length);
      if (breakAfter && chunks.length >= breakAfter) break;
    }
    return { chunks };
  } catch (error) {
    return { chunks, error };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function normalStreaming(ctx) {
  const rt = await ctx.runtime({ limit: 1, queueCapacity: 0 });
  const stream = rt.stream('Count from 1 to 10, one number per short line.');
  ctx.check('timing before iteration', stream.timing === undefined, 'undefined', String(stream.timing));
  // With limit 1 and no queue, a run() would be rejected if the un-iterated stream held the slot.
  const probe = await rt.run(SHORT_PROMPT).then(() => 'ok', (e) => describe(e));
  ctx.check('lazy: un-iterated stream holds no slot', probe === 'ok', 'run() admitted', probe);

  let timingDuringIteration = 'not observed';
  const { chunks, error } = await consume(stream, ctx, {
    onChunk: (n) => { if (n === 1) timingDuringIteration = String(stream.timing); },
  });
  ctx.check('iteration completes', !error, 'no error', error && describe(error));
  ctx.check('at least one chunk', chunks.length >= 1, '>= 1', chunks.length);
  ctx.check('chunks are strings', chunks.every((c) => typeof c === 'string'), 'all strings', chunks.map((c) => typeof c).join());
  ctx.check('timing hidden while running', timingDuringIteration === 'undefined', 'undefined', timingDuringIteration);
  ctx.check('timing defined after', stream.timing !== undefined, 'TaskTiming', String(stream.timing));
  ctx.check('timing.total is a number', typeof stream.timing.total === 'number', 'number', typeof stream.timing.total);
  ctx.check('timing.prompt is a number', typeof stream.timing.prompt === 'number', 'number', typeof stream.timing.prompt);
  ctx.check('runtime still ready', rt.state === 'ready', 'ready', rt.state);
  ctx.note(`chunks: ${chunks.length}`);
  ctx.note(`total: ${Math.round(stream.timing.total)}ms`);
}

async function earlyBreak(ctx) {
  const rt = await ctx.runtime({ limit: 1, queueCapacity: 0 });
  const stream = rt.stream(LONG_PROMPT);
  const { chunks, error } = await consume(stream, ctx, { breakAfter: 1 });
  // Runs synchronously right after the loop exit: admission would be 'rejected' if the slot were
  // still held, so this proves cleanup had completed when `break` finished.
  const probe = rt.run(SHORT_PROMPT).then(() => 'ok', (e) => describe(e));
  ctx.check('break throws nothing', !error, 'no error', error && describe(error));
  ctx.check('received a chunk', chunks.length >= 1, '>= 1', chunks.length);
  ctx.check('timing defined', stream.timing !== undefined, 'TaskTiming', String(stream.timing));
  ctx.check('timing.prompt undefined', stream.timing.prompt === undefined, 'undefined', String(stream.timing.prompt));
  ctx.check('timing.total is a number', typeof stream.timing.total === 'number', 'number', typeof stream.timing.total);
  const p = await probe;
  ctx.check('slot released when break completed', p === 'ok', 'next run() admitted', p);
  ctx.note(`chunks before break: ${chunks.length}`);
  ctx.note('cleanup completed: true');
  ctx.note(`prompt timing: ${stream.timing.prompt}`);
}

async function callerAbort(ctx) {
  const rt = await ctx.runtime({ limit: 1, queueCapacity: 0 });
  const controller = new AbortController();
  const stream = rt.stream(LONG_PROMPT, { signal: controller.signal });
  const { chunks, error } = await consume(stream, ctx, {
    onChunk: (n) => { if (n === 1) controller.abort(); },
  });
  log(`abort outcome: ${error ? describe(error) : 'no error'}; signal.reason: ${controller.signal.reason?.name}`);
  console.log('caller abort error', error);
  ctx.check('received a chunk before abort', chunks.length >= 1, '>= 1', chunks.length);
  ctx.check('ends with TaskError', error instanceof TaskError, 'TaskError(code=cancelled)', error ? describe(error) : 'completed without error');
  ctx.check('code cancelled', error.code === 'cancelled', 'cancelled', error.code);
  ctx.check('cause present', error.cause !== undefined, 'defined', String(error.cause));
  ctx.check('cause is the signal reason', error.cause === controller.signal.reason, 'controller.signal.reason', describe(error));
  ctx.check('timing defined', stream.timing !== undefined, 'TaskTiming', String(stream.timing));
  const probe = await rt.run(SHORT_PROMPT).then(() => 'ok', (e) => describe(e));
  ctx.check('runtime reusable after abort', probe === 'ok', 'run() succeeds', probe);
  ctx.note(`TaskError.code: ${error.code}`);
  ctx.note(`cause.name: ${error.cause?.name}`);
}

async function shutdownDuringStreaming(ctx) {
  const rt = await ctx.runtime();
  const stream = rt.stream(LONG_PROMPT);
  let firstChunk;
  const gotFirst = new Promise((r) => { firstChunk = r; });
  const consuming = consume(stream, ctx, { onChunk: (n) => { if (n === 1) firstChunk(); } });
  await withTimeout(gotFirst, 60_000, 'first chunk');

  // Separate control flow: never await shutdown inside the consumer loop.
  await withTimeout(rt.shutdown(), SHUTDOWN_TIMEOUT_MS, 'shutdown()');
  const timingAtShutdown = stream.timing;
  const { error } = await withTimeout(consuming, 10_000, 'consumer after shutdown');
  console.log('shutdown error', error);
  ctx.check('shutdown resolved', true, 'resolved', 'resolved');
  ctx.check('timing published when shutdown resolved', timingAtShutdown !== undefined, 'TaskTiming', String(timingAtShutdown));
  ctx.check('consumer ended with TaskError', error instanceof TaskError, 'TaskError(code=cancelled)', error ? describe(error) : 'completed without error');
  ctx.check('code cancelled', error.code === 'cancelled', 'cancelled', error.code);
  ctx.check('cause.name AbortError', error.cause?.name === 'AbortError', 'AbortError', error.cause?.name);
  ctx.check('state closed', rt.state === 'closed', 'closed', rt.state);
  const run = await rt.run(SHORT_PROMPT).then(() => 'ok', (e) => (e instanceof TaskError ? e.code : describe(e)));
  ctx.check('run() after shutdown rejected', run === 'closed', 'closed', run);
  const next = await consume(rt.stream(SHORT_PROMPT), ctx);
  const code = next.error instanceof TaskError ? next.error.code : describe(next.error);
  ctx.check('stream() after shutdown rejected on first pull', code === 'closed', 'closed', code);
  ctx.note(`runtime state: ${rt.state}`);
  ctx.note('shutdown completed: true');
}

async function lazyStream(ctx) {
  const rt = await ctx.runtime();
  const stream = rt.stream('Return OK');
  await sleep(300);
  ctx.check('timing undefined before use', stream.timing === undefined, 'undefined', String(stream.timing));
  ctx.check('runtime ready', rt.state === 'ready', 'ready', rt.state);
  const t0 = performance.now();
  await withTimeout(rt.shutdown(), 5_000, 'shutdown() with an un-iterated stream');
  const ms = Math.round(performance.now() - t0);
  const { error } = await consume(stream, ctx);
  const code = error instanceof TaskError ? error.code : error ? describe(error) : 'no error';
  ctx.check('first pull after shutdown → closed', code === 'closed', 'closed', code);
  ctx.check('timing set by the rejection', stream.timing !== undefined, 'TaskTiming', String(stream.timing));
  ctx.note(`shutdown with unused stream: ${ms}ms`);
  ctx.note(`first consumption: TaskError(${code})`);
}

const TESTS = [
  ['Normal streaming', normalStreaming],
  ['Early break', earlyBreak],
  ['Caller abort', callerAbort],
  ['Shutdown during streaming', shutdownDuringStreaming],
  ['Lazy stream', lazyStream],
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function runTest([name, fn]) {
  $('current').textContent = name;
  $('chunks').textContent = '';
  log(`=== ${name} ===`);
  const ctx = context();
  let failure;
  try {
    await withTimeout(fn(ctx), TEST_TIMEOUT_MS, `${name} (harness watchdog)`);
  } catch (e) {
    failure = e;
    console.error(`[FAIL] ${name}`, e);
  } finally {
    for (const rt of ctx.runtimes) {
      await withTimeout(rt.shutdown(), SHUTDOWN_TIMEOUT_MS, 'cleanup shutdown()').catch((e) => {
        failure ??= e;
        console.error('cleanup shutdown failed', e);
      });
    }
  }
  const header = `[${failure ? 'FAIL' : 'PASS'}] ${name}`;
  const body = failure
    ? failure instanceof SmokeFailure ? failure.message : `Unexpected error\nActual: ${describe(failure)}`
    : ctx.lines.join('\n');
  $('results').innerHTML += `<span class="${failure ? 'fail' : 'pass'}">${header}</span>\n${escape(body)}\n\n`;
  $('current').textContent = '–';
  return !failure;
}

const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Disabling every button while a test runs prevents overlapping runs.
async function guarded(fn) {
  document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try { await fn(); } finally {
    document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

function addButton(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => guarded(onClick);
  $('buttons').append(b);
}

async function main() {
  const exists = 'LanguageModel' in globalThis;
  $('exists').textContent = String(exists);
  if (!exists) {
    $('availability').textContent = 'n/a';
    $('unavailable').textContent = 'LanguageModel is not available in this browser.';
    $('unavailable').hidden = false;
    return;
  }
  // availability() only reports status; it never starts a download (create() would).
  const availability = await LanguageModel.availability();
  $('availability').textContent = availability;
  if (availability !== 'available') {
    $('unavailable').textContent =
      'LanguageModel exists, but model is not currently available.\n' +
      'Install/download the browser model before running smoke tests.';
    $('unavailable').hidden = false;
    return;
  }
  for (const test of TESTS) addButton(test[0], () => runTest(test));
  addButton('Run All', async () => {
    let passed = 0;
    for (const test of TESTS) if (await runTest(test)) passed++; // continue after failures
    log(`Run All: ${passed}/${TESTS.length} passed`);
  });
}

main().catch((e) => {
  console.error(e);
  $('unavailable').textContent = `Setup error: ${describe(e)}`;
  $('unavailable').hidden = false;
});
