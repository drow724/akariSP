// Research-only calculations, shared by the browser page and the stand-in check.
export const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Wall-clock overlap of two [start, end] intervals:
 *  overlapMs = max(0, min(a.end, b.end) - max(a.start, b.start));
 *  overlapRatio = overlapMs / min(a.end - a.start, b.end - b.start). */
export const overlap = (a, b) => {
  const ms = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return { ms, ratio: shorter > 0 ? ms / shorter : null };
};

const r1 = (x) => x === null ? null : Math.round(x * 10) / 10;

/** One row per case from raw trials. */
export const summarize = (trials) => {
  const cases = [...new Set(trials.map((t) => t.case))];
  return cases.map((c) => {
    const ts = trials.filter((t) => t.case === c);
    const tasks = ts.flatMap((t) => t.tasks);
    return {
      case: c,
      limit: ts[0].limit ?? null,
      tasks: ts[0].tasks.length,
      trials: ts.length,
      batchWallMedian: r1(median(ts.map((t) => t.batchWallMs))),
      taskMedian: r1(median(tasks.map((k) => k.settledAt - k.submitAt))),
      promptMedian: r1(median(tasks.map((k) => k.native ? k.native.end - k.native.start : null))),
      queueMedian: r1(median(tasks.map((k) => k.timing?.queueWait ?? null))),
      overlapMedianMs: r1(median(ts.map((t) => t.overlap?.ms ?? null))),
      overlapRatioMedian: median(ts.map((t) => t.overlap?.ratio ?? null)),
      errors: tasks.filter((k) => k.error).length,
    };
  });
};
