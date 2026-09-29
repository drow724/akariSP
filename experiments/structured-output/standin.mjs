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
