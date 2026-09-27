// Real WebLLM validation of AkariSP's internal WebLLM integration (007, FR-615).
// Lifecycle only; the model is downloaded only by the explicit "Load model" click.
import * as webllm from 'https://esm.run/@mlc-ai/web-llm@0.2.85';
import { createWebLLMRuntime } from '../dist/webllm/runtime.js'; // internal module, not a public entry

const VERSION = '0.2.85';
const MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const SYSTEM = { role: 'system', content: 'You are a helpful assistant.' };
const SESSION = { initialPrompts: [SYSTEM], temperature: 0, max_tokens: 48 };
const LONG = 'Explain how a CPU cache works in detail, with many sections.';
const WATCHDOG_MS = 120_000;

const $ = (id) => document.getElementById(id);
const results = {};
let cached = false;
let stalled = false;

function log(...parts) {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${parts.join(' ')}`;
  $('log').textContent += line + '\n';
  console.log(line);
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const outcome = (p) => p.then(() => 'ok', (e) => e?.code ?? e?.name);
const marker = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
function check(ok, detail) { if (!ok) throw new Error(detail); return detail; }

/** A fresh engine from the browser cache; each runtime owns and unloads its engine. */
const engineFor = () => webllm.CreateMLCEngine(MODEL);

async function consume(stream, { breakAfter, onChunk } = {}) {
  const chunks = [];
  try {
    for await (const c of stream) {
      chunks.push(c);
      onChunk?.(chunks.length);
      if (breakAfter && chunks.length >= breakAfter) break;
    }
    return { chunks };
  } catch (error) {
    return { chunks, error };
  }
}

const CHECKS = {
  async isolation() {
    const rt = await createWebLLMRuntime(await engineFor(), { session: SESSION });
    const m = marker();
    await rt.run(`Remember the code word ${m}. Reply with OK.`);
    const b = await rt.run('If you were told a code word earlier in this conversation, repeat it. Otherwise reply NONE.');
    await rt.shutdown();
    return check(b.output.length > 0 && !b.output.includes(m), `marker ${m}; task B: ${JSON.stringify(b.output)}`);
  },

  async cloneless() {
    const rt = await createWebLLMRuntime(await engineFor(), { session: SESSION });
    const r = await rt.run('Reply with OK.');
    const s = await consume(rt.stream('Reply with OK.'));
    await rt.shutdown();
    return check(r.output.length > 0 && !s.error && s.chunks.join('').length > 0, `run ${r.output.length} chars; stream ${s.chunks.length} chunks`);
  },

  async serialization() {
    const engine = await engineFor();
    const limit2 = await outcome(createWebLLMRuntime(engine, { limit: 2 }));
    check(limit2 === 'TypeError', `limit 2 → ${limit2}`);
    const rt = await createWebLLMRuntime(engine, { session: { ...SESSION, max_tokens: 128 }, queueCapacity: 1 });
    let aEnd, bFirst;
    const a = rt.run(LONG).then((r) => { aEnd = performance.now(); return r; });
    const b = consume(rt.stream('Reply with OK.'), { onChunk: (n) => { if (n === 1) bFirst = performance.now(); } });
    await tick();
    const snap = rt.snapshot();
    await Promise.all([a, b]);
    await rt.shutdown();
    return check(snap.active === 1 && snap.queued === 1 && bFirst >= aEnd,
      `limit 2 → TypeError; snapshot active ${snap.active} queued ${snap.queued}; B first chunk ${Math.round(bFirst - aEnd)} ms after A ended`);
  },

  async queuedCancel() {
    const rt = await createWebLLMRuntime(await engineFor(), { session: { ...SESSION, max_tokens: 128 }, queueCapacity: 1 });
    const a = rt.run(LONG);
    const ctrl = new AbortController();
    const b = outcome(rt.run('Reply with OK.', { signal: ctrl.signal }));
    await tick();
    ctrl.abort();
    const [ra, rb] = [await a, await b];
    await rt.shutdown();
    return check(rb === 'cancelled' && ra.output.length > 0, `B ${rb}; A completed with ${ra.output.length} chars`);
  },

  async activeCancel() {
    const rt = await createWebLLMRuntime(await engineFor(), { session: { ...SESSION, max_tokens: 256 } });
    const ctrl = new AbortController();
    const a = await consume(rt.stream(LONG, { signal: ctrl.signal }), { onChunk: (n) => { if (n === 2) ctrl.abort(); } });
    const next1 = await rt.run('Name three colors.');
    const timedOut = await outcome(rt.run(LONG, { signal: AbortSignal.timeout(300) }));
    const next2 = await rt.run('Name three colors.');
    await rt.shutdown();
    return check(a.error?.code === 'cancelled' && next1.output.length > 0 && timedOut === 'cancelled' && next2.output.length > 0,
      `abort → ${a.error?.code}, next ${next1.output.length} chars; timeout → ${timedOut}, next ${next2.output.length} chars`);
  },

  async earlyBreak() {
    const rt = await createWebLLMRuntime(await engineFor(), { session: { ...SESSION, max_tokens: 256 } });
    const a = await consume(rt.stream(LONG), { breakAfter: 2 });
    const t0 = performance.now();
    const next = await rt.run('Name three colors.');
    const ms = Math.round(performance.now() - t0);
    await rt.shutdown();
    return check(!a.error && a.chunks.length === 2 && next.output.length > 0, `broke after 2 chunks; next run ${next.output.length} chars in ${ms} ms`);
  },

  async shutdownUnload() {
    const engine = await engineFor();
    const rt = await createWebLLMRuntime(engine, { session: { ...SESSION, max_tokens: 256 } });
    let first;
    const got = new Promise((r) => { first = r; });
    const s = consume(rt.stream(LONG), { onChunk: (n) => { if (n === 1) first(); } });
    await got;
    await rt.shutdown();
    const after = await outcome(engine.getMessage());
    const { error } = await s;
    return check(after === 'ModelNotLoadedError' && error?.code === 'cancelled',
      `after shutdown getMessage → ${after}; stream → ${error?.code}; state ${rt.state}`);
  },

  async classification() {
    const engine = await engineFor();
    const rt = await createWebLLMRuntime(engine, { session: SESSION, templates: { bad: { ...SESSION, temperature: -1 } } });
    const ordinary = await outcome(rt.run('Hi', { template: 'bad' }));
    const stateAfterOrdinary = rt.state;
    await engine.unload(); // behind the runtime's back
    const broken = await outcome(rt.run('Hi'));
    return check(ordinary === 'failed' && stateAfterOrdinary === 'ready' && broken === 'broken' && rt.state === 'broken',
      `invalid setting → ${ordinary} (state ${stateAfterOrdinary}); unloaded engine → ${broken} (state ${rt.state})`);
  },

  async templates() {
    const rt = await createWebLLMRuntime(await engineFor(), {
      templates: {
        apple: { initialPrompts: [{ role: 'system', content: 'Reply only with the word APPLE.' }], temperature: 0, max_tokens: 8 },
        banana: { initialPrompts: [{ role: 'system', content: 'Reply only with the word BANANA.' }], temperature: 0, max_tokens: 8 },
      },
    });
    const outputs = [];
    for (const t of ['apple', 'banana', 'apple', 'banana']) outputs.push([t, (await rt.run('Answer now.', { template: t })).output]);
    await rt.shutdown();
    return check(outputs.every(([t, o]) => o.toUpperCase().includes(t.toUpperCase())), JSON.stringify(outputs));
  },
};

function render() {
  const doc = {
    recordedAt: new Date().toISOString(),
    runner: { kind: 'manual' },
    userAgent: navigator.userAgent,
    webllm: VERSION,
    model: MODEL,
    webgpu: 'gpu' in navigator,
    checks: results,
  };
  $('json').textContent = JSON.stringify(doc, null, 2);
}

async function run(name) {
  if (!cached) return log(`${name}: click Load model first`);
  if (stalled) return log(`${name}: a check stalled; reload the page first`);
  log(`=== ${name} ===`);
  let timer;
  const watchdog = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no result within ${WATCHDOG_MS} ms`)), WATCHDOG_MS); });
  let status, detail;
  try {
    detail = await Promise.race([CHECKS[name](), watchdog]);
    status = 'PASS';
  } catch (e) {
    status = 'FAIL';
    detail = e?.message ?? String(e);
    if (detail.startsWith('no result')) stalled = true;
    console.error(e);
  } finally {
    clearTimeout(timer);
  }
  results[name] = { status, detail };
  $('results').innerHTML += `<span class="${status.toLowerCase()}">[${status}] ${name}</span>\n${detail}\n\n`;
  log(`${name}: ${status} — ${detail}`);
  render();
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
addButton('Load model (downloads once)', async () => {
  const engine = await webllm.CreateMLCEngine(MODEL, { initProgressCallback: (p) => { $('progress').textContent = p.text; } });
  await engine.unload();
  cached = true;
  $('cached').textContent = 'yes';
  log('model cached');
}, 'setup');
addButton('Copy JSON', async () => {
  try { await navigator.clipboard.writeText($('json').textContent); log('JSON copied'); } catch (e) { log(`copy failed (${e.name})`); }
}, 'setup');
for (const name of Object.keys(CHECKS)) addButton(name, () => run(name));
addButton('Run All', async () => { for (const name of Object.keys(CHECKS)) await run(name); });
render();
