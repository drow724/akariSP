import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, gate, outcomeOf, overall, diagnose } from '../smoke/report.js';

// Compatibility harness outcome logic (spec 006). No browser needed.

const LIFECYCLE = ['run', 'streaming', 'earlyBreak', 'callerAbort', 'shutdownDuringStreaming', 'lazyStream', 'cloneIsolation'];
const ALL = ['API_ABSENT', 'API_PRESENT_UNAVAILABLE', 'MODEL_DOWNLOADABLE', 'MODEL_DOWNLOADING', 'MODEL_AVAILABLE', 'UNKNOWN_AVAILABILITY'];
const api = (raw: unknown, extra = {}) => ({ present: true, hasAvailability: true, raw, ...extra });

test('classify maps only the four known values; anything else is unknown', () => {
  assert.equal(classify({ present: false }), 'API_ABSENT');
  assert.equal(classify({ present: true, hasAvailability: false }), 'API_PRESENT_UNAVAILABLE');
  assert.equal(classify(api(undefined, { error: new Error('x') })), 'API_PRESENT_UNAVAILABLE');
  assert.equal(classify(api('unavailable')), 'API_PRESENT_UNAVAILABLE');
  assert.equal(classify(api('downloadable')), 'MODEL_DOWNLOADABLE');
  assert.equal(classify(api('downloading')), 'MODEL_DOWNLOADING');
  assert.equal(classify(api('available')), 'MODEL_AVAILABLE');
  assert.equal(classify(api('readily')), 'UNKNOWN_AVAILABILITY');
  assert.equal(classify(api('toString')), 'UNKNOWN_AVAILABILITY');
});

test('gate: secure context', () => {
  assert.deepEqual(gate('API_ABSENT', true, null), { status: 'SKIPPED', reason: 'LanguageModel API absent' });
  assert.equal(gate('MODEL_AVAILABLE', true, 'available'), null);
  for (const c of ['API_PRESENT_UNAVAILABLE', 'MODEL_DOWNLOADABLE', 'MODEL_DOWNLOADING', 'UNKNOWN_AVAILABILITY']) {
    assert.equal(gate(c, true, 'raw-x').status, 'BLOCKED', c);
  }
  assert.equal(gate('MODEL_DOWNLOADABLE', true, 'downloadable').reason, 'availability: downloadable');
  assert.equal(gate('API_PRESENT_UNAVAILABLE', true, null).reason, 'availability: API_PRESENT_UNAVAILABLE');
});

test('gate: insecure context × every classification (never executes)', () => {
  for (const c of ALL) {
    const g = gate(c, false, 'available');
    assert.equal(g.status, c === 'API_ABSENT' ? 'SKIPPED' : 'BLOCKED', c);
  }
  assert.equal(gate('MODEL_AVAILABLE', false, 'available').reason, 'not a secure context');
});

test('outcomeOf: refusal seen in the check is BLOCKED, other failures FAIL', () => {
  const refusal = new DOMException('denied', 'NotAllowedError');
  assert.equal(outcomeOf(undefined, false), 'PASS');
  assert.equal(outcomeOf(new Error('assert'), true), 'FAIL');
  assert.equal(outcomeOf(new Error('assert'), true, [refusal]), 'BLOCKED');
  assert.equal(outcomeOf(new Error('assert'), true, [{ name: 'TaskError', cause: refusal }]), 'BLOCKED');
  assert.equal(outcomeOf(new Error('assert'), true, [new DOMException('x', 'AbortError')]), 'FAIL');
  assert.equal(outcomeOf(refusal, false), 'BLOCKED');
  assert.equal(outcomeOf({ name: 'TaskError', cause: refusal }, false), 'BLOCKED');
  assert.equal(outcomeOf(new TypeError('boom'), false), 'FAIL');
  // one cause level only
  assert.equal(outcomeOf(new Error('x'), true, [{ name: 'A', cause: { name: 'B', cause: refusal } }]), 'FAIL');
});

const map = (statuses: string[]) => Object.fromEntries(LIFECYCLE.map((k, i) => [k, { status: statuses[i] }]));
const all = (s: string) => map(LIFECYCLE.map(() => s));

test('overall precedence; SKIPPED-only is never PASS', () => {
  const pass = { import: { status: 'PASS' } };
  assert.equal(overall({ ...pass, ...all('SKIPPED') }, LIFECYCLE), 'SKIPPED');
  assert.equal(overall({ ...pass, ...all('PASS') }, LIFECYCLE), 'PASS');
  assert.equal(overall({ ...pass, ...all('BLOCKED') }, LIFECYCLE), 'BLOCKED');
  const mixed = { ...pass, ...all('PASS'), streaming: { status: 'BLOCKED' }, run: { status: 'FAIL' } };
  assert.equal(overall(mixed, LIFECYCLE), 'FAIL');
  assert.equal(overall({ import: { status: 'FAIL' }, ...all('SKIPPED') }, LIFECYCLE), 'FAIL');
  assert.equal(overall(pass, LIFECYCLE), 'INCOMPLETE');
  assert.equal(overall({ ...pass, run: { status: 'PASS' } }, LIFECYCLE), 'INCOMPLETE');
});

test('INFO never changes statuses, counts, or overall', () => {
  const counts = (t: Record<string, { status: string }>) =>
    ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].map((s) => Object.values(t).filter((x) => x.status === s).length);
  const base = [
    { import: { status: 'PASS' }, ...all('PASS') },
    { import: { status: 'PASS' }, ...all('SKIPPED') },
    { import: { status: 'PASS' }, ...all('BLOCKED') },
    { import: { status: 'PASS' }, ...map(['PASS', 'FAIL', 'PASS', 'BLOCKED', 'PASS', 'PASS', 'PASS']) },
    { import: { status: 'PASS' }, run: { status: 'PASS' } },
  ];
  for (const t of base) {
    for (const observed of [true, false]) {
      const withInfo = structuredClone(t) as Record<string, { status: string; info?: unknown }>;
      for (const k of Object.keys(withInfo)) withInfo[k].info = { marker: 'ab12cd34', markerObservedInOtherTask: observed };
      assert.equal(overall(withInfo, LIFECYCLE), overall(t, LIFECYCLE));
      assert.equal(Object.keys(withInfo).length, Object.keys(t).length);
      assert.deepEqual(counts(withInfo), counts(t));
      assert.deepEqual(Object.values(withInfo).map((x) => x.status), Object.values(t).map((x) => x.status));
    }
  }
});

test('diagnose records name, constructor, message, code, cause name', () => {
  const e = Object.assign(new Error('boom', { cause: new DOMException('d', 'NotAllowedError') }), { code: 'failed' });
  assert.deepEqual(diagnose(e), { name: 'Error', constructor: 'Error', message: 'boom', code: 'failed', causeName: 'NotAllowedError' });
});
