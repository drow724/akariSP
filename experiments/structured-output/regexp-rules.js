// Research-only (013 revisit condition 2): categories for the "numbers only as {Dn} references"
// workload. Pure functions; no DOM, no model.
export const REGEXP_RULE_VERSION = 1;

/** Categories, first match wins: provider_error, empty, bare_digit, invalid_ref, no_ref, ok.
 *  bare_digit: a digit outside a {D<n>} token. invalid_ref: a {…} that is not a known reference, or a
 *  stray brace. no_ref: no reference at all (the answer ignored the data). */
export function categorizeRef(output, error, known) {
  if (error) return 'provider_error';
  const s = output.trim();
  if (s === '') return 'empty';
  const refs = [...s.matchAll(/\{D([0-9]+)\}/g)].map((m) => `D${m[1]}`);
  const rest = s.replace(/\{D[0-9]+\}/g, '');
  if (/[0-9]/.test(rest)) return 'bare_digit';
  if (/[{}]/.test(rest) || refs.some((r) => !known.includes(r))) return 'invalid_ref';
  if (refs.length === 0) return 'no_ref';
  return 'ok';
}

/** A violation is a bare digit: the failure the constraint targets. No workaround is defined here
 *  (a bare number equal to exactly one known value could be mapped back; others lose their meaning). */
export const isViolation = (category) => category === 'bare_digit';
