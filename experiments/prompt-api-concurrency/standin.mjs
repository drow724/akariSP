// DETERMINISTIC_STAND_IN: validates only the harness calculations (overlap, median, summary).
// It says nothing about Prompt API scheduling. Usage (repo root):
//   node experiments/prompt-api-concurrency/standin.mjs
import assert from 'node:assert/strict';
import { median, overlap, summarize } from './stats.js';

assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 3, 2]), 2.5);
assert.equal(median([null, 5]), 5);
assert.equal(median([]), null);

assert.deepEqual(overlap({ start: 0, end: 10 }, { start: 10, end: 20 }), { ms: 0, ratio: 0 }); // back to back
assert.deepEqual(overlap({ start: 0, end: 10 }, { start: 12, end: 20 }), { ms: 0, ratio: 0 }); // gap
assert.deepEqual(overlap({ start: 0, end: 10 }, { start: 5, end: 20 }), { ms: 5, ratio: 0.5 }); // partial
assert.deepEqual(overlap({ start: 0, end: 20 }, { start: 5, end: 15 }), { ms: 10, ratio: 1 }); // contained
assert.deepEqual(overlap({ start: 5, end: 15 }, { start: 0, end: 20 }), { ms: 10, ratio: 1 }); // symmetric

const task = (submitAt, settledAt, start, end, queueWait) =>
  ({ submitAt, settledAt, native: { start, end }, timing: { queueWait } });
const [row] = summarize([
  { case: 'L2', limit: 2, batchWallMs: 20, overlap: { ms: 5, ratio: 0.5 }, tasks: [task(0, 10, 1, 9, 0), task(0, 20, 5, 19, 0)] },
  { case: 'L2', limit: 2, batchWallMs: 30, overlap: { ms: 7, ratio: 0.7 }, tasks: [task(0, 12, 1, 11, 0), task(0, 30, 6, 29, 0)] },
]);
assert.deepEqual(row, { case: 'L2', limit: 2, tasks: 2, trials: 2, batchWallMedian: 25, taskMedian: 16,
  promptMedian: 12, queueMedian: 0, overlapMedianMs: 6, overlapRatioMedian: 0.6, errors: 0 });
console.log('stand-in calculations: ok');
