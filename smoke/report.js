// Pure outcome logic for the compatibility harness (spec 006, research C3–C6). No DOM, no
// browser names, no user agent. Tested by test/report.test.ts.

const KNOWN = {
  unavailable: 'API_PRESENT_UNAVAILABLE',
  downloadable: 'MODEL_DOWNLOADABLE',
  downloading: 'MODEL_DOWNLOADING',
  available: 'MODEL_AVAILABLE',
};

export function classify({ present, hasAvailability, raw, error }) {
  if (!present) return 'API_ABSENT';
  if (!hasAvailability || error) return 'API_PRESENT_UNAVAILABLE';
  return Object.hasOwn(KNOWN, raw) ? KNOWN[raw] : 'UNKNOWN_AVAILABILITY';
}

/** null = execute the check; otherwise the outcome recorded without executing it. */
export function gate(classification, secureContext, raw) {
  if (classification === 'API_ABSENT') return { status: 'SKIPPED', reason: 'LanguageModel API absent' };
  if (!secureContext) return { status: 'BLOCKED', reason: 'not a secure context' };
  if (classification !== 'MODEL_AVAILABLE') return { status: 'BLOCKED', reason: `availability: ${raw ?? classification}` };
  return null;
}

export const refused = (e) => e?.name === 'NotAllowedError' || e?.cause?.name === 'NotAllowedError';

/** A browser refusal seen anywhere in the check (one cause level) is BLOCKED, even when an
 *  existing check body turned it into an assertion failure; any other failure is FAIL. */
export function outcomeOf(error, isAssertion, seenErrors = []) {
  if (!error) return 'PASS';
  if (refused(error) || seenErrors.some(refused)) return 'BLOCKED';
  return 'FAIL'; // assertion, watchdog, or unexpected error
}

/** Reads only `.status`; `info` never affects the result. */
export function overall(tests, lifecycleKeys) {
  const statuses = Object.values(tests).map((t) => t.status);
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  const lifecycle = lifecycleKeys.map((k) => tests[k]?.status);
  if (lifecycle.every((s) => s === 'SKIPPED')) return 'SKIPPED';
  if (lifecycle.every((s) => s === 'PASS')) return 'PASS';
  return 'INCOMPLETE';
}

export function diagnose(e) {
  const d = { name: e?.name, constructor: e?.constructor?.name, message: e?.message };
  if (e?.code !== undefined) d.code = e.code;
  if (e?.cause?.name !== undefined) d.causeName = e.cause.name;
  return d;
}
