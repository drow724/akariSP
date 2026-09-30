// DETERMINISTIC_STAND_IN: checks only rules.js (parsing, categories, workaround, decisions).
// It says nothing about Prompt API behavior. Usage (repo root):
//   node experiments/structured-output/standin.mjs
import assert from 'node:assert/strict';
import { categorize, workaroundOk, summarize, decideR1, decideGate } from './rules.js';

const F = '```';
assert.equal(categorize('{"id":"48213"}'), 'ok');
assert.equal(categorize('  {"id":"48213"}\n'), 'ok');
assert.equal(categorize(`${F}json\n{"id":"48213"}\n${F}`), 'fence');
assert.equal(categorize(`${F}\n{"id":"48213"}\n${F}`), 'fence');
assert.equal(categorize('{"id":123}'), 'schema_mismatch');
assert.equal(categorize('{"id":"12a"}'), 'schema_mismatch');
assert.equal(categorize('{"id":"1","note":"x"}'), 'schema_mismatch');
assert.equal(categorize('["48213"]'), 'schema_mismatch');
assert.equal(categorize('The id is 48213.'), 'not_json');
assert.equal(categorize(' \n\t '), 'empty');
assert.equal(categorize(null, { name: 'NotSupportedError', message: 'x' }), 'provider_error');

assert.equal(workaroundOk(`${F}json\n{"id":"48213"}\n${F}`), true);
assert.equal(workaroundOk(`${F}\n{"id":"48213"}\n${F}`), true);
assert.equal(workaroundOk(`${F}json\n{"id":48213}\n${F}`), false);
assert.equal(workaroundOk('{"id":"48213"}'), true);
assert.equal(workaroundOk('Sure: {"id":"48213"}'), false);
assert.equal(workaroundOk(null), false);

const att = (category, extra = {}) => ({ category, latencyMs: 10, fallbackNeeded: category !== 'ok',
  workaroundOk: category === 'fence', error: category === 'provider_error' ? { name: 'UnknownError' } : null, ...extra });
const arm = (spec) => summarize(Object.entries(spec).flatMap(([c, n]) => Array.from({ length: n }, () => att(c))));

const control = arm({ ok: 26, fence: 4 });
assert.deepEqual([control.parseFailures, control.fallbackCount, control.workaroundRecovered, control.counts.fence], [4, 4, 4, 4]);
assert.equal(decideR1(arm({ ok: 30 }), arm({ ok: 30 })), 'failure not reproduced');
assert.equal(decideR1(control, arm({ ok: 30 })), 'material improvement');
assert.equal(decideR1(control, arm({ ok: 28, schema_mismatch: 2 })), 'material improvement'); // 2 = ⌊4/2⌋
assert.equal(decideR1(control, arm({ ok: 27, schema_mismatch: 3 })), 'no material improvement');
assert.equal(decideR1(control, arm({ ok: 29, fence: 1 })), 'no material improvement');
assert.equal(decideR1(control, arm({ ok: 29, provider_error: 1 })), 'no material improvement'); // new error name
assert.equal(decideR1(arm({ ok: 28, fence: 1, provider_error: 1 }), arm({ ok: 29, provider_error: 1 })), 'material improvement');

assert.deepEqual(decideGate({ r1: 'BLOCKED' }), { gate: 1, outcome: 'NO_CHANGE' });
assert.deepEqual(decideGate({ r1: 'failure not reproduced' }), { gate: 2, outcome: 'NO_CHANGE' });
assert.deepEqual(decideGate({ r1: 'no material improvement' }), { gate: 3, outcome: 'NO_CHANGE' });
assert.deepEqual(decideGate({ r1: 'material improvement', control }), { gate: 4, outcome: 'NO_CHANGE' });
const partial = summarize([...Array.from({ length: 26 }, () => att('ok')), att('fence'), att('fence'), att('not_json'), att('not_json')]);
assert.deepEqual(decideGate({ r1: 'material improvement', control: partial, r3: { promptApi: 'C', webllm: 'C' } }), { gate: 5, outcome: 'NO_CHANGE' });
assert.deepEqual(decideGate({ r1: 'material improvement', control: partial, r3: { promptApi: 'A', webllm: 'C' } }), { gate: null, outcome: 'REQUIRES_REVIEW' });
console.log('stand-in rules: ok');

// RegExp workload rules (regexp-rules.js)
import { categorizeRef } from './regexp-rules.js';
const K = ['D1', 'D2'];
assert.equal(categorizeRef('Orders reached {D1} while returns were {D2}.', null, K), 'ok');
assert.equal(categorizeRef('Orders reached 48213 while returns were {D2}.', null, K), 'bare_digit');
assert.equal(categorizeRef('Orders were {D1} in Q3.', null, K), 'bare_digit');
assert.equal(categorizeRef('Orders reached {D3}.', null, K), 'invalid_ref');
assert.equal(categorizeRef('Orders reached {orders}.', null, K), 'invalid_ref');
assert.equal(categorizeRef('Orders were strong this week.', null, K), 'no_ref');
assert.equal(categorizeRef('  ', null, K), 'empty');
assert.equal(categorizeRef(null, { name: 'SyntaxError' }, K), 'provider_error');
console.log('stand-in regexp rules: ok');

// Consumer-workload rules (refs-rules.js, v1)
import { numbers, violations, decideRefsGate } from './refs-rules.js';
assert.deepEqual(numbers('6만 5,320원').map((n) => n.value), [65320]);
assert.deepEqual(numbers('9,125만 원, -11.2%, 2026-09-15').map((n) => n.value), [91250000, 11.2, '2026-09-15']);
const R = [{ name: 'D1b', shown: '9,125만 원' }, { name: 'M1a', shown: '-11.2%' }, { name: 'M1b', shown: '20' }, { name: 'H3', shown: '7만 1,000원' }];
const types = (raw, q = '') => violations(raw, R, q).violations.map((v) => `${v.type}:${v.repairable}`);
assert.deepEqual(types('평가액은 {D1b}이고 {M1a} 하락했습니다.'), []);
assert.deepEqual(types('평가액은 {D1b} 91,250,000 KRW입니다.'), ['duplicate:true']);
assert.deepEqual(types('평가액은 91,250,000원입니다.'), ['bare:true']);
assert.deepEqual(types('약 27% 올랐습니다.'), ['bare:false']);
assert.deepEqual(types('{M1a, D1b} 기준입니다.'), ['combined:true']);
assert.deepEqual(types('{M1a, Z9} 기준입니다.'), ['combined:false']);
assert.deepEqual(types('{Z9}입니다.'), ['unknown_ref:false']);
assert.deepEqual(types('M1b 동안 {M1a} 하락.'), ['unbraced:true']);
assert.deepEqual(types('{d1B}, { M1a }입니다.'), []);
assert.deepEqual(types('3개 종목 중 2개입니다.'), []);             // integers ≤ 10 exempt
assert.deepEqual(types('매수가 71,000원이면?', '매수가 71,000원이면 손익은?'), []); // value from the question
assert.equal(violations('{D1b}와 {M1a}', R, '').refs, 2);
const s = (withViolation, withUnrepairable = 0, errors = []) => ({ withViolation, withUnrepairable, errors });
assert.deepEqual(decideRefsGate({ blocked: true }), { gate: 1, outcome: 'BLOCKED' });
assert.deepEqual(decideRefsGate({ control: s(0), treatment: s(0) }), { gate: 2, outcome: 'NO_CHANGE' });
assert.deepEqual(decideRefsGate({ control: s(10, 2), treatment: s(6) }), { gate: 3, outcome: 'NO_CHANGE' });
assert.deepEqual(decideRefsGate({ control: s(10, 2), treatment: s(0, 0, ['SyntaxError']) }), { gate: 3, outcome: 'NO_CHANGE' });
assert.deepEqual(decideRefsGate({ control: s(10, 0), treatment: s(0) }), { gate: 4, outcome: 'NO_CHANGE' });
assert.deepEqual(decideRefsGate({ control: s(10, 2), treatment: s(5) }), { gate: 5, outcome: 'REQUIRES_REVIEW' });
console.log('stand-in refs rules: ok');
