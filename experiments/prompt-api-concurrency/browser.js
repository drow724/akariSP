// Research-only: REAL_BROWSER_PROMPT_API characterization of concurrent cloned-session prompts.
// Loads the repository build (run `npm run build` first; serve the repo root).
// Instrumentation: LanguageModel.create is wrapped so every clone's prompt() records its own
// wall-clock call interval. AkariSP itself is unmodified and is used only via its public API.
import { createRuntime, TaskError } from '../../dist/index.js';
import { overlap, summarize } from './stats.js';

const SESSION = { initialPrompts: [{ role: 'system', content: 'You are a concise assistant.' }] };
const WORKLOAD = 'numbered-8-v1';
const PROMPTS = ['astronomy', 'geology'].map((topic) =>
  `Write exactly 8 numbered short sentences about ${topic}. No introduction and no conclusion.`);
const CASES = ['NC', 'L1', 'L2']; // NC: native Promise.all outside AkariSP; L1/L2: AkariSP limit
const WARMUP_ROUNDS = 2, TRIALS = 10, TIMEOUT_MS = 120_000;
const head = new URLSearchParams(location.search).get('head');

const $ = (id) => document.getElementById(id);
const log = (s) => { $('log').textContent += s + '\n'; };
const describe = (e) => e === undefined ? null
  : { ctor: e?.constructor?.name ?? typeof e, name: e?.name ?? null, message: e?.message ?? String(e) };

// --- native instrumentation ---------------------------------------------------------------
let intervals = []; // { input, start, end } for the current trial
const nativeCreate = LanguageModel.create.bind(LanguageModel);
LanguageModel.create = async (options) => {
  const base = await nativeCreate(options);
  const nativeClone = base.clone.bind(base);
  base.clone = async (o) => {
    const session = await nativeClone(o);
    const nativePrompt = session.prompt.bind(session);
    session.prompt = async (input, po) => {
      const rec = { input, start: performance.now(), end: null };
      intervals.push(rec);
      try { return await nativePrompt(input, po); } finally { rec.end = performance.now(); }
    };
    return session;
  };
  return base;
};
const nativeOf = (input) => {
  const r = intervals.find((i) => i.input === input);
  return r && r.end !== null ? { start: r.start, end: r.end } : null;
};
const pairOverlap = (tasks) => tasks.length === 2 && tasks.every((t) => t.native)
  ? overlap(tasks[0].native, tasks[1].native) : null;

// --- cases ------------------------------------------------------------------------------
async function nativeTrial(base) {
  const clones = [];
  for (const _ of PROMPTS) clones.push(await base.clone());
  intervals = [];
  const batchStart = performance.now();
  const tasks = await Promise.all(PROMPTS.map(async (p, i) => {
    const t = { submitAt: batchStart };
    try { t.outputChars = (await clones[i].prompt(p, { signal: AbortSignal.timeout(TIMEOUT_MS) })).length; }
    catch (e) { t.error = describe(e); }
    t.settledAt = performance.now();
    return t;
  }));
  const batchEnd = performance.now();
  for (const c of clones) c.destroy();
  tasks.forEach((t, i) => { t.native = nativeOf(PROMPTS[i]); });
  return { batchStart, batchEnd, batchWallMs: batchEnd - batchStart, tasks };
}

async function runtimeTrial(runtime) {
  intervals = [];
  const snapshots = [];
  const sample = () => {
    const s = runtime.snapshot(), last = snapshots.at(-1);
    if (!last || last.active !== s.active || last.queued !== s.queued || last.state !== s.state) {
      snapshots.push({ t: performance.now(), state: s.state, active: s.active, queued: s.queued });
    }
  };
  const batchStart = performance.now();
  const pending = PROMPTS.map((p) => {
    const t = { submitAt: performance.now() };
    t.promise = runtime.run(p, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then(
      (r) => { t.outputChars = r.output.length; t.timing = r.timing; },
      (e) => { t.error = describe(e); t.code = e instanceof TaskError ? e.code : null; t.cause = describe(e?.cause); t.timing = e?.timing ?? null; },
    ).then(() => { t.settledAt = performance.now(); sample(); });
    return t;
  });
  sample(); // synchronously after submission: admission is synchronous up to the first await
  const snapshotAfterSubmit = { ...snapshots[0] };
  const timer = setInterval(sample, 5);
  await Promise.all(pending.map((t) => t.promise));
  clearInterval(timer);
  const batchEnd = performance.now();
  const tasks = pending.map(({ promise, ...t }, i) => ({ ...t, native: nativeOf(PROMPTS[i]) }));
  return {
    batchStart, batchEnd, batchWallMs: batchEnd - batchStart, tasks, snapshotAfterSubmit, snapshots,
    maxActive: Math.max(...snapshots.map((s) => s.active)), maxQueued: Math.max(...snapshots.map((s) => s.queued)),
    stateAfter: runtime.state,
  };
}

// --- run ----------------------------------------------------------------------------------
async function environment(availability) {
  let uaData = null;
  try { uaData = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList', 'platform', 'platformVersion', 'architecture']); } catch {}
  let packageVersion = null;
  try { packageVersion = (await (await fetch('../../package.json')).json()).version; } catch {}
  return {
    timestamp: new Date().toISOString(), akarispHead: head, packageVersion, userAgent: navigator.userAgent, uaData,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null,
    promptApiAvailability: availability, flags: 'none set by the harness (record manually if any)',
  };
}

$('avail').textContent = await LanguageModel.availability();

$('run').onclick = async () => {
  const availability = await LanguageModel.availability();
  if (availability !== 'available') return log(`availability is "${availability}"; refusing (no download).`);
  $('run').disabled = true;
  const out = {
    environment: await environment(availability),
    config: { workload: WORKLOAD, prompts: PROMPTS, session: SESSION, cases: CASES, concurrentTasks: PROMPTS.length,
      queueCapacity: 32, warmupRounds: WARMUP_ROUNDS, trialsPerCase: TRIALS, order: 'case order rotated per round',
      timeoutMs: TIMEOUT_MS },
    warmups: [], trials: [],
  };
  const base = await LanguageModel.create(SESSION);
  const runtimes = { L1: await createRuntime({ session: SESSION, limit: 1 }), L2: await createRuntime({ session: SESSION, limit: 2 }) };
  const one = async (c) => {
    const r = c === 'NC' ? await nativeTrial(base) : await runtimeTrial(runtimes[c]);
    return { case: c, limit: c === 'NC' ? null : Number(c.slice(1)), ...r, overlap: pairOverlap(r.tasks) };
  };
  try {
    for (let round = 0; round < WARMUP_ROUNDS + TRIALS; round++) {
      const order = CASES.map((_, i) => CASES[(i + round) % CASES.length]);
      for (const c of order) {
        const r = await one(c);
        if (round < WARMUP_ROUNDS) out.warmups.push({ round, ...r });
        else out.trials.push({ trial: out.trials.length, round: round - WARMUP_ROUNDS, ...r });
        log(`${round < WARMUP_ROUNDS ? 'warmup' : 'trial'} ${round} ${c}: batch ${Math.round(r.batchWallMs)} ms, overlap ${r.overlap ? Math.round(r.overlap.ms) : '-'} ms, errors ${r.tasks.filter((t) => t.error).length}`);
      }
    }
  } catch (e) {
    out.aborted = describe(e);
    log(`aborted: ${e}`);
  } finally {
    base.destroy();
    for (const rt of Object.values(runtimes)) await rt.shutdown();
  }
  out.summary = summarize(out.trials).sort((a, b) => CASES.indexOf(a.case) - CASES.indexOf(b.case));
  $('json').textContent = JSON.stringify(out, null, 2);
  log('done');
};
$('copy').onclick = () => navigator.clipboard.writeText($('json').textContent);
