# Prompt API concurrent clones: research

Researched 2026-09-28 at `7e8202e` (`akarisp` 0.1.0-alpha.2). Research only: no production change,
no default-limit decision. Results: [EVIDENCE.md](EVIDENCE.md).

## Question

When AkariSP runs several native Prompt API task sessions cloned from one warm base and calls
`prompt()` concurrently, how much do those native `prompt()` call lifetimes overlap on the wall
clock, and what do `limit: 1` and `limit: 2` change for batch wall time, per-task latency,
queueing and errors?

Terms, kept apart:

- **Application concurrency**: two `run()` calls submitted together.
- **AkariSP concurrency**: `snapshot().active > 1`.
- **Provider execution overlap**: two native `prompt()` call lifetimes overlap on the wall clock.

None of them says anything about GPU or hardware parallelism, and this research makes no such claim.

## Runtime model (SOURCE_ANALYSIS)

- `src/browser/runtime.ts`: `create` = `LanguageModel.create(config)`, `start` =
  `base.clone({ signal })`, `destroy(base)` = `base.destroy()`.
- `src/core/runtime.ts`: slot acquire → `start()` → `prompt()` → task `destroy()` → slot release.
- Defaults: `limit` 1, `queueCapacity` 32.
- `TaskTiming.prompt` measures AkariSP's wait on `task.prompt()`. It does not separate time spent
  waiting inside the browser from time spent generating.

Prior evidence: none for Prompt API concurrency. `bench/` measured `limit` 1 only. WebLLM 0.2.85
serialized generations with a per-model FIFO lock (`experiments/webllm/EVIDENCE.md` E3). That is
WebLLM evidence only.

## Design

`index.html` + `browser.js` in real Chrome with `availability() === 'available'`. The page refuses
any other state, so it never starts a download.

| Case | What runs | Evidence |
|---|---|---|
| NC | Two clones of one native base, `Promise.all` of their `prompt()` calls, outside AkariSP | provider |
| L1 | `createRuntime({ session, limit: 1 })`, two `run()`s submitted together | runtime + provider |
| L2 | `createRuntime({ session, limit: 2 })`, two `run()`s submitted together | runtime + provider |

- **Workload** `numbered-8-v1`: "Write exactly 8 numbered short sentences about {astronomy |
  geology}. No introduction and no conclusion." Same structure and item count; only the topic
  differs. No external data.
- **Order**: each round runs all three cases, and the case order rotates every round. 2 warmup
  rounds are stored separately and excluded, then 10 measured rounds (30 trials).
- **Timeout**: 120 s per task.
- **Native instrumentation**: the page wraps `LanguageModel.create` so each clone's `prompt()`
  records `performance.now()` right before and after the native call. The wrapper is applied to the
  NC base and to both AkariSP runtimes' bases. AkariSP is unmodified and used only through its public
  API.
- **Queue evidence**: `snapshot()` is read synchronously right after both `run()` calls (admission
  is synchronous up to its first await), then sampled every 5 ms. Only state transitions are
  stored.
- **Per task**: `submitAt`, `settledAt`, `TaskTiming`, native `{ start, end }`, output length,
  error. **Per trial**: `batchWallMs` = all settled − batch start.

Overlap (`stats.js`, checked by `standin.mjs`):

```js
overlapMs    = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
overlapRatio = overlapMs / Math.min(a.end - a.start, b.end - b.start);
```

Not included: an isolation marker check (covered by 001), and L3/L4 (see EVIDENCE.md).

## Reproduce

```bash
node experiments/prompt-api-concurrency/standin.mjs   # DETERMINISTIC_STAND_IN: calculations only
npm run build
python3 -m http.server 8080
# Chrome with the model available:
# http://localhost:8080/experiments/prompt-api-concurrency/index.html?head=<short sha>
# Run, wait several minutes, Copy JSON, save as results/chrome-<major>-run-NN.json unchanged.
```
