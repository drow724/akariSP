import { createRuntime } from '../dist/index.js';

// Same workload for both paths. Edit these to benchmark your own prompts.
const SESSION = {
  initialPrompts: [{ role: 'system', content: 'You are a concise assistant. Answer in one sentence.' }],
};
const PROMPTS = [
  'What is the capital of France?',
  'Name one benefit of unit tests.',
  'What does HTTP stand for?',
  'Give a synonym for "fast".',
  'What is 12 times 12?',
];

const $ = (id) => document.getElementById(id);
const status = (text) => { $('status').textContent = text; };

async function cold(input) {
  const t0 = performance.now();
  const session = await LanguageModel.create(SESSION);
  const t1 = performance.now();
  let t2;
  try {
    await session.prompt(input);
    t2 = performance.now();
  } finally {
    session.destroy();
  }
  return { create: t1 - t0, prompt: t2 - t1, total: performance.now() - t0 };
}

async function warm(runtime, input) {
  const { timing: t } = await runtime.run(input);
  return { ...t, overhead: t.total - t.queueWait - t.acquire - t.prompt };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p95: s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)],
    max: s[s.length - 1],
  };
}

const summarize = (rows) =>
  Object.fromEntries(Object.keys(rows[0]).map((k) => [k, stats(rows.map((r) => r[k]))]));

async function main() {
  const iterations = Number($('iterations').value);
  const warmup = Number($('warmup').value);
  if (!('LanguageModel' in self)) throw new Error('Prompt API (LanguageModel) is not available.');
  const availability = await LanguageModel.availability();
  if (availability !== 'available') throw new Error(`Model availability: ${availability}`);

  // Load the on-device model first so baseCreate measures session creation, not model load.
  status('Loading model…');
  (await LanguageModel.create(SESSION)).destroy();

  status('Creating warm base session…');
  const tb = performance.now();
  const runtime = await createRuntime({ session: SESSION });
  const baseCreate = performance.now() - tb;

  const coldRows = [];
  const warmRows = [];
  try {
    for (let i = 0; i < warmup + iterations; i++) {
      status(i < warmup ? `Warmup ${i + 1}/${warmup}` : `Iteration ${i - warmup + 1}/${iterations}`);
      const input = PROMPTS[i % PROMPTS.length];
      // Alternate which path goes first to reduce order/thermal bias.
      let c, w;
      if (i % 2) {
        c = await cold(input);
        w = await warm(runtime, input);
      } else {
        w = await warm(runtime, input);
        c = await cold(input);
      }
      if (i >= warmup) {
        coldRows.push(c);
        warmRows.push(w);
      }
    }
  } finally {
    await runtime.shutdown();
  }

  const warmTotals = warmRows.map((r) => r.total);
  const amortizedTotal = Object.fromEntries(
    [1, 10, 30].filter((n) => n <= warmTotals.length).map((n) => [
      n,
      (baseCreate + warmTotals.slice(0, n).reduce((a, b) => a + b, 0)) / n,
    ]),
  );

  const coldStats = summarize(coldRows);
  const warmStats = summarize(warmRows);
  return {
    note: 'AkariSP amortizes session initialization over repeated tasks; warm.baseCreate is a real one-time cost.',
    config: { iterations, warmup, prompts: PROMPTS, session: SESSION, order: 'interleaved, alternating first path' },
    env: {
      userAgent: navigator.userAgent,
      brands: navigator.userAgentData?.brands,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      date: new Date().toISOString(),
    },
    cold: coldStats,
    warm: { baseCreate, ...warmStats, amortizedTotal },
    checks: {
      'SC-001 warm.acquire.median × 10 ≤ cold.create.median': warmStats.acquire.median * 10 <= coldStats.create.median,
      'SC-002 warm.overhead.median < 1 ms': warmStats.overhead.median < 1,
    },
  };
}

$('run').onclick = async () => {
  $('run').disabled = true;
  $('out').textContent = '';
  try {
    $('out').textContent = JSON.stringify(await main(), null, 2);
    status('Done. Save this JSON to bench/results/YYYY-MM-DD-<device>.json');
  } catch (e) {
    status(`Error: ${e?.message ?? e}`);
  } finally {
    $('run').disabled = false;
  }
};
