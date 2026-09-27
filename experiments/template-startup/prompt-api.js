// Research-only (pre-feature 012): REAL_BROWSER template startup with the Prompt API already
// available. Loads the repository build (run `npm run build` first; serve the repo root).
// The page wraps LanguageModel.create only to timestamp each call; AkariSP itself is unmodified.
import { createRuntime } from '../../dist/index.js';

const COUNTS = [1, 2, 4], RUNS = 5;
const SESSION = { initialPrompts: [{ role: 'system', content: 'Answer in one word.' }] };
const $ = (id) => document.getElementById(id);
const log = (s) => { $('log').textContent += s + '\n'; };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => Math.round(x * 10) / 10;
const stats = (xs) => ({ median: r1(q(xs, 0.5)), min: r1(Math.min(...xs)), max: r1(Math.max(...xs)), samples: xs.map(r1) });

const native = LanguageModel.create.bind(LanguageModel);
let spans = [];
LanguageModel.create = async (o) => { const s = performance.now(); const b = await native(o); spans.push([s, performance.now()]); return b; };

$('avail').textContent = await LanguageModel.availability();

$('run').onclick = async () => {
  const availability = await LanguageModel.availability();
  if (availability !== 'available') return log(`availability is "${availability}"; refusing (no download).`);
  $('run').disabled = true;
  (await native(SESSION)).destroy(); // warmup: loads the model once; excluded from results
  log('warmup done');
  const akarisp = [], nativeParallel = [];
  for (const n of COUNTS) {
    const templates = Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, SESSION]));
    const totals = [], perCreate = [], overhead = [];
    for (let i = 0; i < RUNS; i++) {
      spans = [];
      const t0 = performance.now();
      const rt = await createRuntime({ templates });
      const total = performance.now() - t0;
      await rt.shutdown();
      totals.push(total); perCreate.push(...spans.map(([s, e]) => e - s));
      overhead.push(total - spans.reduce((a, [s, e]) => a + (e - s), 0));
    }
    akarisp.push({ bases: n, runs: RUNS, startupMs: stats(totals), perCreateMs: stats(perCreate), nonCreateMs: stats(overhead) });
    log(`AkariSP ${n} base(s): median ${r1(q(totals, 0.5))} ms`);
    // Comparison only (outside AkariSP): does the browser serve concurrent creates in parallel?
    const par = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const bases = await Promise.all(Array.from({ length: n }, () => native(SESSION)));
      par.push(performance.now() - t0);
      bases.forEach((b) => b.destroy());
    }
    nativeParallel.push({ bases: n, runs: RUNS, wallMs: stats(par) });
    log(`native Promise.all ${n}: median ${r1(q(par, 0.5))} ms`);
  }
  $('json').textContent = JSON.stringify({ evidence: 'REAL_BROWSER', date: new Date().toISOString(), userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, availability,
    warmup: 'one create+destroy before measuring (model load excluded)', timing: 'performance.now()', session: SESSION,
    akarispSequential: akarisp, nativeConcurrentCreateOutsideAkariSP: nativeParallel }, null, 2);
  $('run').disabled = false;
};
$('copy').onclick = () => navigator.clipboard.writeText($('json').textContent);
