// Research-only (pre-feature 012): how does createRuntime() startup scale with the number of warm
// bases today? DETERMINISTIC_STAND_IN: a fake LanguageModel whose create() waits a fixed delay.
// It measures the existing sequential code as-is (src/ is not modified).
// "Bases" = named templates only (no default session), so bases === templates.
// Usage (repo root): node experiments/template-startup/sequential.mjs > experiments/template-startup/sequential-results-<date>.json
import os from 'node:os';

const DELAYS = [0, 10, 50, 100, 250];
const COUNTS = [1, 2, 4, 8, 16];
const WARMUP = 3, RUNS = 15;

let spans = []; // [start, end] of each create()
let delay = 0;
globalThis.LanguageModel = {
  async create() {
    const start = performance.now();
    if (delay) await new Promise((r) => setTimeout(r, delay)); else await null;
    spans.push([start, performance.now()]);
    return { async clone() {}, destroy() {} };
  },
};
const { createRuntime } = await import('../../src/index.ts');

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const round = (x) => Math.round(x * 100) / 100;
const rows = [];
for (const d of DELAYS) {
  delay = d;
  for (const n of COUNTS) {
    const templates = Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, {}]));
    const totals = [], overheads = [], gaps = [];
    for (let i = 0; i < WARMUP + RUNS; i++) {
      spans = [];
      const t0 = performance.now();
      const rt = await createRuntime({ templates });
      const total = performance.now() - t0;
      await rt.shutdown();
      if (i < WARMUP) continue;
      const createSum = spans.reduce((a, [s, e]) => a + (e - s), 0);
      totals.push(total);
      overheads.push(total - createSum); // everything that is not inside create()
      gaps.push(spans.slice(1).reduce((a, [s], k) => a + (s - spans[k][1]), 0) / Math.max(1, n - 1)); // create end → next create start
    }
    rows.push({ bases: n, delayMs: d, runs: RUNS, expectedSequentialMs: n * d,
      startupMs: { median: round(q(totals, 0.5)), p95: round(q(totals, 0.95)), min: round(Math.min(...totals)), max: round(Math.max(...totals)) },
      akarispOverheadMs: { median: round(q(overheads, 0.5)), p95: round(q(overheads, 0.95)) },
      gapBetweenCreatesMs: { median: round(q(gaps, 0.5)) } });
  }
}
console.log(JSON.stringify({ evidence: 'DETERMINISTIC_STAND_IN', date: new Date().toISOString(), node: process.version,
  os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, source: 'src/ at HEAD (sequential createCoreRuntime)',
  definition: 'bases = named templates (no default session)', warmup: WARMUP, runs: RUNS, timing: 'performance.now()', rows }, null, 2));
