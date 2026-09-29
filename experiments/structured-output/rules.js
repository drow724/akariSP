// Research-only (013): the fixed parsing rule, failure categories, workaround rule and decision rule
// from specs/013-task-scoped-provider-options/research.md R1. Pure functions; no DOM, no model.
export const PARSING_RULE_VERSION = 1;

const FENCE = /^```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/;

/** Parsing rule: the whole trimmed output is a plain object with exactly one key `id`, a digit string. */
export function parses(text) {
  let v;
  try { v = JSON.parse(text); } catch { return false; }
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).length === 1 && typeof v.id === 'string' && /^[0-9]+$/.test(v.id);
}

/** First match wins: provider_error, empty, fence, not_json, schema_mismatch, ok. */
export function categorize(output, error) {
  if (error) return 'provider_error';
  const s = output.trim();
  if (s === '') return 'empty';
  if (s.startsWith('```')) return 'fence';
  try { JSON.parse(s); } catch { return 'not_json'; }
  return parses(s) ? 'ok' : 'schema_mismatch';
}

/** FR-1304a: remove one outer fence if present, then apply the same parsing rule. Analysis only. */
export function workaroundOk(output) {
  if (output == null) return false;
  const s = output.trim();
  const m = FENCE.exec(s);
  return parses(m ? m[1].trim() : s);
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Per-arm summary of a list of attempts. */
export function summarize(attempts) {
  const counts = { ok: 0, provider_error: 0, empty: 0, fence: 0, not_json: 0, schema_mismatch: 0 };
  const providerErrors = {};
  for (const a of attempts) {
    counts[a.category]++;
    if (a.category === 'provider_error') providerErrors[a.error.name] = (providerErrors[a.error.name] ?? 0) + 1;
  }
  const lat = attempts.map((a) => a.latencyMs);
  const failed = attempts.filter((a) => a.category !== 'ok' && a.category !== 'provider_error');
  return {
    attempts: attempts.length,
    counts,
    parseFailures: failed.length,
    providerErrors,
    fallbackCount: attempts.filter((a) => a.fallbackNeeded).length,
    latencyMs: { median: median(lat), min: lat.length ? Math.min(...lat) : null, max: lat.length ? Math.max(...lat) : null },
    workaroundRecovered: failed.filter((a) => a.workaroundOk).length,
  };
}

/** FR-1304 (clarified): exactly one of three results. */
export function decideR1(control, treatment) {
  if (control.parseFailures === 0) return 'failure not reproduced';
  const newErrors = Object.keys(treatment.providerErrors).some((n) => !(n in control.providerErrors));
  const improved = treatment.parseFailures <= Math.floor(control.parseFailures / 2)
    && treatment.counts.fence === 0 && !newErrors;
  return improved ? 'material improvement' : 'no material improvement';
}

/** Gates 1–5 of contracts/evidence-and-decision.md; gates 6–8 are a human decision. */
export function decideGate({ r1, control, r3 }) {
  if (r1 === 'BLOCKED') return { gate: 1, outcome: 'NO_CHANGE' };
  if (r1 === 'failure not reproduced') return { gate: 2, outcome: 'NO_CHANGE' };
  if (r1 === 'no material improvement') return { gate: 3, outcome: 'NO_CHANGE' };
  if (control.workaroundRecovered === control.parseFailures) return { gate: 4, outcome: 'NO_CHANGE' };
  if (r3 && Object.values(r3).every((c) => c === 'C' || c === 'D')) return { gate: 5, outcome: 'NO_CHANGE' };
  return { gate: null, outcome: 'REQUIRES_REVIEW' };
}
