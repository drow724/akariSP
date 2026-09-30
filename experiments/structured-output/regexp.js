// Research-only (013 revisit condition 2): does a RegExp responseConstraint stop bare digits in a
// "numbers only as {Dn} references" workload? Runs directly on native task sessions (AkariSP cannot
// pass prompt options). Same shape as harness.js: 3 warmup + 30 measured per arm, ABBA.
import { REGEXP_RULE_VERSION, categorizeRef, isViolation } from './regexp-rules.js';

const SYSTEM = { role: 'system', content: 'You are a concise business analyst.' };
const DATA = [
  [['48213', 'orders this week'], ['312', 'returns this week']],
  [['1207', 'active users'], ['88', 'new signups']],
  [['3390', 'support tickets'], ['41', 'escalations']],
  [['70516', 'page views'], ['57', 'bounce rate in percent']],
  [['885104', 'revenue in dollars'], ['19', 'refunds']],
];
const KNOWN = ['D1', 'D2'];
const prompt = (d) => 'Here is data. Each value has a reference label.\n'
  + d.map(([v, what], i) => `D${i + 1} = ${v} (${what})`).join('\n')
  + '\n\nWrite one short sentence comparing the two values. Never write any digits. '
  + 'Refer to a value only by its label in braces, like {D1} or {D2}.';
const REF = /^([^0-9{}]|\{D[0-9]+\})*$/;           // treatment: digits only inside {D<n>}
const LOOKAHEAD = /^(?![\s\S]*[0-9])[\s\S]*$/;     // limits probe: no digit anywhere, via lookahead
const WARMUP = 3, MEASURED = 30, PROBE = 3, TIMEOUT_MS = 60_000;

const $ = (id) => document.getElementById(id);
const log = (s) => { $('log').textContent += s + '\n'; };
const err = (e) => ({ name: e?.name ?? typeof e, message: e?.message ?? String(e) });
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function call(base, text, constraint) {
  const clone = await base.clone();
  let output = null, error = null;
  const t0 = performance.now();
  try {
    output = await clone.prompt(text, { signal: AbortSignal.timeout(TIMEOUT_MS), ...(constraint !== undefined ? { responseConstraint: constraint } : {}) });
  } catch (e) { error = err(e); } finally { clone.destroy(); }
  return { output, error, latencyMs: performance.now() - t0 };
}

async function attempt(base, phase, arm, round, index, constraint) {
  const d = DATA[round % DATA.length];
  const r = await call(base, prompt(d), constraint);
  const category = categorizeRef(r.output, r.error, KNOWN);
  const a = { phase, arm, round, index, data: d.map(([v]) => v).join('/'), ...r, category,
    violation: isViolation(category), refs: r.output ? (r.output.match(/\{D[0-9]+\}/g) ?? []).length : 0 };
  log(`${phase} ${arm} r${round}: ${category}${r.error ? ` (${r.error.name})` : ''} ${Math.round(r.latencyMs)} ms`);
  return a;
}

const summarize = (xs) => {
  const counts = {};
  for (const a of xs) counts[a.category] = (counts[a.category] ?? 0) + 1;
  return { attempts: xs.length, counts, violations: xs.filter((a) => a.violation).length,
    errors: xs.filter((a) => a.error).map((a) => a.error.name), latencyMedianMs: median(xs.map((a) => a.latencyMs)),
    outputCharsMedian: median(xs.filter((a) => a.output).map((a) => a.output.length)) };
};

$('avail').textContent = await LanguageModel.availability();

$('run').onclick = async () => {
  const availability = await LanguageModel.availability();
  if (availability !== 'available') return log(`availability is "${availability}"; refusing (no download).`);
  $('run').disabled = true;
  let uaData = null;
  try { uaData = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList', 'platform', 'platformVersion', 'architecture']); } catch {}
  const out = {
    environment: { date: new Date().toISOString(), userAgent: navigator.userAgent, uaData,
      hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, availability },
    protocol: { system: SYSTEM, data: DATA, prompt: prompt(DATA[0]), treatment: String(REF), lookaheadProbe: String(LOOKAHEAD),
      ruleVersion: REGEXP_RULE_VERSION, warmupPerArm: WARMUP, measuredPerArm: MEASURED, probe: PROBE, timeoutMs: TIMEOUT_MS,
      order: 'acceptance probes, then warmup and measured with ABBA per pair of rounds, then the lookahead probe' },
    acceptance: {}, attempts: [],
  };
  let base;
  try {
    base = await LanguageModel.create({ initialPrompts: [SYSTEM] });
    // Does Chrome accept a RegExp constraint at all, and reject a non-schema value?
    out.acceptance.simpleRegExp = await call(base, 'Is the sky usually blue on a clear day? Answer yes or no.', /^(yes|no)$/);
    out.acceptance.invalidValue = await call(base, 'Say hello.', 42);
    log(`acceptance: simple ${out.acceptance.simpleRegExp.error?.name ?? JSON.stringify(out.acceptance.simpleRegExp.output)}, invalid ${out.acceptance.invalidValue.error?.name ?? 'accepted'}`);
    let index = 0;
    for (const [phase, rounds] of [['warmup', WARMUP], ['measured', MEASURED]]) {
      for (let round = 0; round < rounds; round++) {
        const arms = round % 2 === 0 ? ['control', 'treatment'] : ['treatment', 'control'];
        for (const arm of arms) out.attempts.push(await attempt(base, phase, arm, round, index++, arm === 'treatment' ? REF : undefined));
      }
    }
    for (let round = 0; round < PROBE; round++) out.attempts.push(await attempt(base, 'probe', 'lookahead', round, index++, LOOKAHEAD));
  } catch (e) {
    out.aborted = err(e);
    log(`aborted: ${out.aborted.name}: ${out.aborted.message}`);
  } finally {
    try { base?.destroy(); } catch {}
  }
  const pick = (phase, arm) => out.attempts.filter((a) => a.phase === phase && a.arm === arm);
  out.summary = { control: summarize(pick('measured', 'control')), treatment: summarize(pick('measured', 'treatment')),
    lookahead: summarize(pick('probe', 'lookahead')) };
  $('json').textContent = JSON.stringify(out, null, 2);
  log('done');
};
$('copy').onclick = () => navigator.clipboard.writeText($('json').textContent);
