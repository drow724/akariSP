// Research-only (013, consumer-workload rerun): violation rule v1 for the BTA "numbers by reference"
// prompts, as fixed in specs/013-task-scoped-provider-options/research.md. Pure functions.
export const REFS_RULE_VERSION = 1;

const UNIT = { '억': 1e8, '만': 1e4 };
const RANK = { '억': 2, '만': 1, '': 0 };

/** Numbers in text: 억/만 multipliers, falling-unit tokens separated only by spaces are summed
 *  ("6만 5,320" = 65320), YYYY-MM-DD is one date token. Values are absolute. */
export function numbers(text) {
  const out = [];
  for (const m of text.matchAll(/(\d{4}-\d{2}-\d{2})|(\d[\d,]*(?:\.\d+)?)(\s*[억만])?(%)?/g)) {
    const start = m.index, end = m.index + m[0].length;
    if (m[1]) { out.push({ start, end, value: m[1], plain: false }); continue; }
    const unit = (m[3] ?? '').trim();
    const value = Number(m[2].replaceAll(',', '')) * (UNIT[unit] ?? 1);
    const prev = out.at(-1);
    if (prev && typeof prev.value === 'number' && prev.unitRank > RANK[unit] && /^ *$/.test(text.slice(prev.end, start))) {
      Object.assign(prev, { end, value: prev.value + value, unitRank: RANK[unit], plain: false });
      continue;
    }
    out.push({ start, end, value, unitRank: RANK[unit], plain: !unit && !m[4] });
  }
  return out;
}

const same = (a, b) => (typeof a === 'number' ? Math.abs(a - b) < 1e-9 : a === b);
const norm = (s) => s[0].toUpperCase() + s.slice(1).replace(/[A-Z]$/, (c) => c.toLowerCase());

/** Violations of one raw answer. refs: [{ name, shown }]. Each has { type, text, repairable }. */
export function violations(raw, refs, questionText) {
  const byName = new Map(refs.map((r) => [r.name, { ...r, values: numbers(r.shown).map((n) => n.value) }]));
  const exemptValues = numbers(questionText).map((n) => n.value);
  const out = [], taken = [], braced = [];
  const take = (s, e) => taken.push([s, e]);
  const inTaken = (s, e) => taken.some(([a, b]) => s < b && e > a);

  for (const m of raw.matchAll(/\{([^{}]*)\}/g)) {
    const inner = m[1].trim(), s = m.index, e = s + m[0].length;
    const names = inner.split(/\s*,\s*/);
    if (names.length > 1 && names.every((n) => /^[A-Za-z]\d+[A-Za-z]?$/.test(n))) {
      out.push({ type: 'combined', text: m[0], repairable: names.every((n) => byName.has(norm(n))) });
      take(s, e);
    } else if (/^[A-Za-z]\d+[A-Za-z]?$/.test(inner)) {
      const ref = byName.get(norm(inner));
      if (ref) braced.push({ s, e, ref }); else out.push({ type: 'unknown_ref', text: m[0], repairable: false });
      take(s, e);
    }
  }
  for (const m of raw.matchAll(/(?<![A-Za-z0-9{])([A-Za-z]\d+[a-z]?)(?![A-Za-z0-9}])/g)) {
    const s = m.index, e = s + m[0].length;
    if (!inTaken(s, e) && byName.has(norm(m[1]))) { out.push({ type: 'unbraced', text: m[1], repairable: true }); take(s, e); }
  }
  for (const n of numbers(raw)) {
    if (inTaken(n.start, n.end)) continue;
    if (exemptValues.some((v) => same(v, n.value))) continue;
    if (n.plain && Number.isInteger(n.value) && n.value <= 10) continue;
    const text = raw.slice(n.start, n.end);
    const near = braced.some((b) => b.ref.values.some((v) => same(v, n.value)) && (
      (b.s >= n.end && b.s - n.end <= 12 && !/\d/.test(raw.slice(n.end, b.s))) ||
      (n.start >= b.e && n.start - b.e <= 12 && !/\d/.test(raw.slice(b.e, n.start)))));
    if (near) { out.push({ type: 'duplicate', text, repairable: true }); continue; }
    const shown = new Set(refs.filter((r) => byName.get(r.name).values.some((v) => same(v, n.value))).map((r) => r.shown));
    out.push({ type: 'bare', text, repairable: shown.size === 1 });
  }
  return { violations: out, refs: braced.length };
}

/** Gate for the rerun (research.md fixed protocol): control/treatment are per-arm summaries. */
export function decideRefsGate({ blocked, control, treatment }) {
  if (blocked) return { gate: 1, outcome: 'BLOCKED' };
  if (control.withViolation === 0) return { gate: 2, outcome: 'NO_CHANGE' };
  const newErrors = treatment.errors.filter((n) => !control.errors.includes(n));
  if (treatment.withViolation > Math.floor(control.withViolation / 2) || newErrors.length) return { gate: 3, outcome: 'NO_CHANGE' };
  if (control.withUnrepairable === 0) return { gate: 4, outcome: 'NO_CHANGE' };
  return { gate: 5, outcome: 'REQUIRES_REVIEW' };
}
