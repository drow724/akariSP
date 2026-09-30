// Research-only (013, consumer-workload rerun): the fixed protocol in
// specs/013-task-scoped-provider-options/research.md. Native calls only: AkariSP cannot pass the option.
import { REFS_RULE_VERSION, violations, decideRefsGate } from './refs-rules.js';

const SET = './inputs/harness-prompts-refs.json';
const TREATMENT = /^([^0-9{}]|\{[A-Z][0-9]+[a-z]?\})*$/;
const WARMUP = 3, TIMEOUT_MS = 120_000;

const $ = (id) => document.getElementById(id);
const log = (s) => { $('log').textContent += s + '\n'; };
const err = (e) => ({ name: e?.name ?? typeof e, message: e?.message ?? String(e) });
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const text = await fetch(SET).then((r) => (r.ok ? r.text() : null)).catch(() => null);
const set = text && JSON.parse(text);
const sha1 = text && [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const unfilled = set ? set.items.filter((i) => !i.filled).length : null;
$('avail').textContent = await LanguageModel.availability();
$('set').textContent = set ? `${set.items.length} items, ${unfilled} unfilled, sha1 ${sha1}` : 'missing';

async function attempt(base, phase, arm, item, index) {
  const clone = await base.clone();
  let output = null, error = null;
  const t0 = performance.now();
  try {
    output = await clone.prompt([{ role: 'user', content: item.finalPrompt }],
      { signal: AbortSignal.timeout(TIMEOUT_MS), ...(arm === 'treatment' ? { responseConstraint: TREATMENT } : {}) });
  } catch (e) { error = err(e); } finally { clone.destroy(); }
  const latencyMs = performance.now() - t0;
  const v = output === null ? { violations: [], refs: 0 } : violations(output, item.refs, item.questionText);
  const a = { phase, arm, index, key: item.key, output, error, latencyMs, refs: v.refs, violations: v.violations };
  log(`${phase} ${arm} ${item.key}: ${error ? error.name : `${v.violations.length} violations, ${v.refs} refs`} ${Math.round(latencyMs)} ms`);
  return a;
}

const summarize = (xs) => {
  const types = {};
  for (const a of xs) for (const v of a.violations) types[`${v.type}:${v.repairable ? 'repairable' : 'unrepairable'}`] = (types[`${v.type}:${v.repairable ? 'repairable' : 'unrepairable'}`] ?? 0) + 1;
  const ok = xs.filter((a) => !a.error);
  return { attempts: xs.length, withViolation: ok.filter((a) => a.violations.length).length,
    withUnrepairable: ok.filter((a) => a.violations.some((v) => !v.repairable)).length, types,
    errors: xs.filter((a) => a.error).map((a) => a.error.name), noRef: ok.filter((a) => a.refs === 0).length,
    latencyMedianMs: median(xs.map((a) => a.latencyMs)), outputCharsMedian: median(ok.map((a) => a.output.length)) };
};

$('run').onclick = async () => {
  const availability = await LanguageModel.availability();
  if (availability !== 'available') return log(`availability is "${availability}"; refusing (no download).`);
  if (!set || unfilled) return log('prompt set missing or not fully filled; refusing.');
  $('run').disabled = true;
  let uaData = null;
  try { uaData = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList', 'platform', 'platformVersion', 'architecture']); } catch {}
  const out = {
    environment: { date: new Date().toISOString(), userAgent: navigator.userAgent, uaData,
      hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, availability },
    protocol: { promptSet: { file: SET, sha1, fixture: set.fixture, generatedAt: set.generatedAt, items: set.items.length },
      treatment: String(TREATMENT), ruleVersion: REFS_RULE_VERSION, warmupPerArm: WARMUP, measuredPerArm: set.items.length,
      timeoutMs: TIMEOUT_MS, session: 'LanguageModel.create() with no options; one clone per attempt; one user message',
      order: 'warmup on items 0-2, then each item once per arm, ABBA over pairs of items' },
    attempts: [],
  };
  let base, index = 0;
  try {
    base = await LanguageModel.create();
    for (const [phase, items] of [['warmup', set.items.slice(0, WARMUP)], ['measured', set.items]]) {
      for (let i = 0; i < items.length; i++) {
        const arms = i % 2 === 0 ? ['control', 'treatment'] : ['treatment', 'control'];
        for (const arm of arms) out.attempts.push(await attempt(base, phase, arm, items[i], index++));
      }
    }
  } catch (e) {
    out.aborted = err(e);
    log(`aborted: ${out.aborted.name}: ${out.aborted.message}`);
  } finally {
    try { base?.destroy(); } catch {}
  }
  const pick = (arm) => out.attempts.filter((a) => a.phase === 'measured' && a.arm === arm);
  out.summary = { control: summarize(pick('control')), treatment: summarize(pick('treatment')) };
  out.decision = decideRefsGate({ blocked: !!out.aborted, ...out.summary });
  $('json').textContent = JSON.stringify(out, null, 2);
  log(`done: gate ${out.decision.gate} → ${out.decision.outcome}`);
};
$('copy').onclick = () => navigator.clipboard.writeText($('json').textContent);
