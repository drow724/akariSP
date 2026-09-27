// Pre-007 evidence: how WebLLM behaves against AkariSP's current core contract.
// Each experiment records observations only; interpretation goes into the 007 research notes.
// The model is downloaded only by the explicit "Load model" click.
import * as webllm from 'https://esm.run/@mlc-ai/web-llm@0.2.85';
import { createCoreRuntime } from '../../dist/core/runtime.js'; // internal module, experiment only

const VERSION = '0.2.85';
const MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const SYSTEM = { role: 'system', content: 'You are a helpful assistant.' };
const LONG = 'Explain how a CPU cache works in detail, with many sections.';

const $ = (id) => document.getElementById(id);
let engine;
let stalled = false; // a stalled engine cannot be cancelled; only a page reload is clean
const results = { recordedAt: null, webllm: VERSION, model: MODEL, userAgent: navigator.userAgent, experiments: {} };

function log(...parts) {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${parts.join(' ')}`;
  $('log').textContent += line + '\n';
  console.log(line);
}
const now = () => Math.round(performance.now());
const WATCHDOG_MS = 120_000; // harness only: a stalled experiment is recorded, never waited on forever
const errInfo = (e) => e && ({
  name: e.name, constructor: e.constructor?.name, isDOMException: e instanceof DOMException,
  message: String(e.message).slice(0, 200),
  ...(e.code !== undefined && { code: e.code }), ...(e.cause && { causeName: e.cause.name, causeConstructor: e.cause.constructor?.name }),
});
const settle = (p) => p.then((value) => ({ value }), (error) => ({ error: errInfo(error) }));
const marker = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
const user = (content, system = SYSTEM) => [system, { role: 'user', content }];

async function ask(messages, extra = {}) {
  const t0 = now();
  const r = await engine.chat.completions.create({ messages, temperature: 0, max_tokens: 64, ...extra });
  return { text: r.choices[0].message.content, finish: r.choices[0].finish_reason, ms: now() - t0, usage: r.usage?.extra };
}

/** Streams a request; `hooks.onChunk(n)` may return 'break'. Returns timing and text. */
async function stream(messages, hooks = {}, extra = {}) {
  const t = { submitted: now() };
  const it = await engine.chat.completions.create({ messages, temperature: 0, max_tokens: 256, stream: true, ...extra });
  if (hooks.label) log(`${hooks.label}: iterator created`);
  let text = '', n = 0, finish = null;
  for await (const chunk of it) {
    n++;
    if (n === 1 && hooks.label) log(`${hooks.label}: first chunk`);
    t.first ??= now();
    text += chunk.choices[0]?.delta?.content ?? '';
    finish = chunk.choices[0]?.finish_reason ?? finish;
    if ((await hooks.onChunk?.(n)) === 'break') { t.broke = now(); break; }
  }
  t.end = now();
  return { t, chunks: n, length: text.length, text: text.slice(0, 120), finish };
}

function record(key, data) {
  results.recordedAt = new Date().toISOString();
  results.experiments[key] = data;
  $('json').textContent = JSON.stringify(results, null, 2);
  log(`${key}:`, JSON.stringify(data));
}

// ---------------------------------------------------------------------------

const EXPERIMENTS = {
  async e1_isolation() {
    const m = marker();
    const probe = 'If you were told a code word earlier in this conversation, repeat it. Otherwise reply NONE.';
    const a = await ask(user(`Remember the code word ${m}. Reply with OK.`));
    const b = await ask(user(probe));
    const c = await ask(user(probe));
    return { marker: m, a: a.text, b: b.text, c: c.text, markerInB: b.text.includes(m), markerInC: c.text.includes(m) };
  },

  async e2_clone_necessity() {
    // Pure request lifecycle: no synthetic clone, no destroy. `config` is captured as the request prefix.
    const provider = {
      async create(config) {
        const prefix = config?.initialPrompts ?? [SYSTEM];
        return {
          prompt: async (input) => (await ask([...prefix, { role: 'user', content: input }])).text,
          promptStreaming: async function* (input) {
            const it = await engine.chat.completions.create({ messages: [...prefix, { role: 'user', content: input }], stream: true, max_tokens: 32 });
            for await (const c of it) yield c.choices[0]?.delta?.content ?? '';
          },
        };
      },
    };
    const created = await settle(createCoreRuntime(provider, { session: { initialPrompts: [SYSTEM] } }));
    if (created.error) return { stage: 'createCoreRuntime', ...created };
    const rt = created.value;
    const run = await settle(rt.run('Reply with OK.'));
    const chunks = [];
    const streamed = await settle((async () => { for await (const c of rt.stream('Reply with OK.')) chunks.push(c); })());
    const shutdown = await settle(rt.shutdown());
    return {
      createRuntime: 'ok',
      run: run.error ?? { output: run.value.output },
      stream: streamed.error ?? { chunks: chunks.length },
      shutdown: shutdown.error ?? 'resolved (base destroy() missing → swallowed by core)',
      stateAfter: rt.state,
    };
  },

  async e3_concurrency() {
    const [a, b] = await Promise.all([stream(user(LONG)), stream(user(LONG))]);
    return { a: a.t, b: b.t, serialized: b.t.first >= a.t.end || a.t.first >= b.t.end };
  },

  async e4_queued_cancel() {
    // 4a: the only public cancel is engine-wide interruptGenerate(). Call it while B waits on the lock.
    let firstA;
    const gotA = new Promise((r) => { firstA = r; });
    const aP = stream(user(LONG), { onChunk: (n) => { if (n === 1) firstA(); } });
    await gotA;
    const bP = stream(user('Reply with OK.'));
    await new Promise((r) => setTimeout(r, 50)); // B is now waiting inside WebLLM
    const tInterrupt = now();
    await engine.interruptGenerate();
    const [a, b] = await Promise.all([aP, bP]);
    const withInterrupt = { tInterrupt, a: { ...a.t, chunks: a.chunks, finish: a.finish }, b: { ...b.t, chunks: b.chunks, length: b.length, finish: b.finish } };

    // 4b: B's own iterator return() while B waits on the lock (no interruptGenerate).
    let firstA2;
    const gotA2 = new Promise((r) => { firstA2 = r; });
    const a2P = stream(user(LONG), { onChunk: (n) => { if (n === 1) firstA2(); } }, { max_tokens: 96 });
    await gotA2;
    const itB = await engine.chat.completions.create({ messages: user('Reply with OK.'), stream: true, max_tokens: 32 });
    const bNext = settle(itB[Symbol.asyncIterator]().next()); // pulls: waits on the lock
    const tReturn = now();
    const bReturn = settle(itB.return ? itB.return() : Promise.resolve('no return()'));
    const [a2, bn, br] = await Promise.all([a2P, bNext, bReturn]);
    return {
      withInterruptGenerate: withInterrupt,
      withIteratorReturn: { tReturn, a: { ...a2.t, chunks: a2.chunks, finish: a2.finish }, bFirstNext: bn.error ?? { done: bn.value.done, gotChunk: !bn.value.done }, bReturn: br.error ?? 'resolved', tBSettled: now() },
    };
  },

  async e5_active_cancel() {
    log('e5: A stream (interrupt at chunk 3)');
    const a = await stream(user(LONG), { onChunk: async (n) => { if (n === 3) await engine.interruptGenerate(); } });
    log('e5: B non-streaming');
    const bNonStreaming = await ask(user('Name three colors.'));
    log('e5: C streaming');
    const cStreaming = await stream(user('Name three colors.'), {}, { max_tokens: 64 });
    log('e5: idle interrupt');
    await engine.interruptGenerate(); // while idle
    log('e5: D non-streaming');
    const dNonStreamingAfterIdleInterrupt = await ask(user('Name three colors.'));
    log('e5: E non-streaming');
    const eNonStreamingNext = await ask(user('Name three colors.'));
    // Leave the engine clean for later experiments, and record whether a streaming request clears it.
    log('e5: F streaming reset');
    const fStreamingReset = await stream(user('Reply with OK.'), {}, { max_tokens: 16 });
    log('e5: G non-streaming');
    const gNonStreamingAfterReset = await ask(user('Name three colors.'));
    return {
      a: { chunks: a.chunks, finish: a.finish },
      bNonStreaming: { length: bNonStreaming.text.length, finish: bNonStreaming.finish },
      cStreaming: { length: cStreaming.length, finish: cStreaming.finish },
      dNonStreamingAfterIdleInterrupt: { length: dNonStreamingAfterIdleInterrupt.text.length, finish: dNonStreamingAfterIdleInterrupt.finish },
      eNonStreamingNext: { length: eNonStreamingNext.text.length, finish: eNonStreamingNext.finish },
      fStreamingReset: { length: fStreamingReset.length, finish: fStreamingReset.finish },
      gNonStreamingAfterReset: { length: gNonStreamingAfterReset.text.length, finish: gNonStreamingAfterReset.finish },
    };
  },

  async e6_early_break() {
    log('e6: A stream (break at chunk 2)');
    const a = await stream(user(LONG), { onChunk: (n) => (n === 2 ? 'break' : undefined) });
    log('e6: A loop exited; B stream');
    const b = await stream(user('Name three colors.'), { label: 'e6: B' }, { max_tokens: 64 });
    log('e6: B done');
    return { aBrokeAt: a.t.broke, aEnd: a.t.end, bSubmitted: b.t.submitted, bFirst: b.t.first, bWaitMs: b.t.first - a.t.end, bLength: b.length, bFinish: b.finish };
  },

  // Workaround candidate for 0.2.85 (lock released only when the generator runs to its end):
  // instead of break/return(), interrupt and keep consuming until the stream ends by itself.
  async e6b_interrupt_drain() {
    log('e6b: A stream (interrupt at chunk 2, then drain)');
    const a = await stream(user(LONG), { onChunk: async (n) => { if (n === 2) await engine.interruptGenerate(); } });
    log('e6b: A drained; B stream');
    const b = await stream(user('Name three colors.'), { label: 'e6b: B' }, { max_tokens: 64 });
    log('e6b: B done');
    return { aChunks: a.chunks, aFinish: a.finish, aEnd: a.t.end, bFirst: b.t.first, bWaitMs: b.t.first - a.t.end, bLength: b.length, bFinish: b.finish };
  },

  async e7_unload() {
    // 7a: interrupt → let A end → unload (awaited).
    const a = await stream(user(LONG), { onChunk: async (n) => { if (n === 3) await engine.interruptGenerate(); } });
    const t0 = now();
    await engine.unload();
    const unloadMs = now() - t0;
    const after = await settle(ask(user('Reply with OK.')));
    return {
      interruptedStream: { chunks: a.chunks, finish: a.finish },
      unloadAwaitedMs: unloadMs,
      requestAfterUnload: after.error ?? { unexpected: after.value },
      note: 'engine unloaded; click Load model again before other experiments',
    };
  },

  async e7b_unload_during_generation() {
    let first;
    const got = new Promise((r) => { first = r; });
    const aP = settle(stream(user(LONG), { onChunk: (n) => { if (n === 1) first(); } }));
    await got;
    const t0 = now();
    const u = await settle(engine.unload());
    const tUnload = now();
    const a = await aP;
    return {
      unload: u.error ?? 'resolved', unloadMs: tUnload - t0,
      stream: a.error ?? { chunks: a.value.chunks, finish: a.value.finish, endedAfterUnloadMs: a.value.t.end - tUnload },
      note: 'engine unloaded; click Load model again',
    };
  },

  async e8_errors() {
    const out = {};
    out.notLoaded = (await settle(new webllm.MLCEngine().chat.completions.create({ messages: user('hi') }))).error;
    out.unknownModel = (await settle(webllm.CreateMLCEngine('no-such-model-xyz'))).error;
    out.invalidConfig = (await settle(ask(user('hi'), { temperature: -1 }))).error ?? 'accepted';
    const interrupted = await stream(user(LONG), { onChunk: async (n) => { if (n === 2) await engine.interruptGenerate(); } });
    out.interruptOutcome = { threw: false, finish: interrupted.finish, chunks: interrupted.chunks };
    const scratch = new webllm.MLCEngine();
    await scratch.unload();
    out.afterUnload = (await settle(scratch.chat.completions.create({ messages: user('hi') }))).error;
    return out;
  },

  async e9_templates() {
    const risk = { role: 'system', content: 'You are a risk analyst. Always start your answer with RISK:' };
    const def = { role: 'system', content: 'You are a friendly assistant. Always start your answer with HELLO:' };
    const q = 'In one short sentence, what do you do?';
    const seq = [['risk', risk], ['default', def], ['risk', risk], ['default', def], ['default', def]];
    const rows = [];
    for (const [name, sys] of seq) {
      const r = await ask(user(q, sys), { max_tokens: 32 });
      rows.push({ template: name, text: r.text, ttftS: r.usage?.time_to_first_token_s, prefillTokS: r.usage?.prefill_tokens_per_s, ms: r.ms });
    }
    return rows;
  },
};

// ---------------------------------------------------------------------------

async function loadModel() {
  if (stalled) return log('an experiment stalled on this page: reload the page first (model is cached)');
  const t0 = now();
  engine = await webllm.CreateMLCEngine(MODEL, {
    initProgressCallback: (p) => { $('progress').textContent = p.text; },
  });
  $('engine').textContent = `loaded (${now() - t0} ms)`;
  log(`model loaded in ${now() - t0} ms`);
}

async function run(key) {
  if (!engine) return log(`${key}: load the model first`);
  log(`=== ${key} ===`);
  // A streaming request clears WebLLM's engine-wide interrupt flag left by an earlier experiment
  // (observed: after e8, every non-streaming request returned "" instantly).
  for await (const _ of await engine.chat.completions.create({ messages: user('Hi'), stream: true, max_tokens: 1 }));
  let timer;
  const t0 = now();
  // Heartbeat: if these lines stop, the main thread is blocked; if they continue, a promise never settles.
  const beat = setInterval(() => log(`${key}: still running (${Math.round((now() - t0) / 1000)} s)`), 10_000);
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`no result within ${WATCHDOG_MS} ms`), { name: 'HarnessTimeout' })), WATCHDOG_MS);
  });
  try {
    record(key, await Promise.race([EXPERIMENTS[key](), stalled]));
  } catch (e) {
    if (e.name === 'HarnessTimeout') {
      // WebLLM work cannot be cancelled from here; the engine may still hold its lock.
      engine = undefined;
      stalled = true;
      $('engine').textContent = 'stalled: reload the page (model is cached)';
      log(`${key}: stalled; reload the page before running anything else`);
    }
    record(key, { harnessError: errInfo(e) });
    console.error(e);
  } finally {
    clearTimeout(timer);
    clearInterval(beat);
  }
  if (key.startsWith('e7')) { engine = undefined; $('engine').textContent = 'unloaded'; }
}

function addButton(label, onClick, parent = 'buttons') {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = async () => {
    document.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    try { await onClick(); } finally { document.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
  };
  $(parent).append(b);
}

$('version').textContent = VERSION;
$('model').textContent = MODEL;
$('webgpu').textContent = 'gpu' in navigator ? 'present' : 'absent';
addButton('Load model (downloads once)', loadModel, 'setup');
addButton('Copy JSON', async () => {
  try { await navigator.clipboard.writeText($('json').textContent); log('JSON copied'); } catch (e) { log(`copy failed (${e.name})`); }
}, 'setup');
for (const key of Object.keys(EXPERIMENTS)) addButton(key, () => run(key));
