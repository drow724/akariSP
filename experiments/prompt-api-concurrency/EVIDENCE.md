# Prompt API concurrent clones: evidence

Raw data: [`results/chrome-153-run-01.json`](results/chrome-153-run-01.json). It was run by the
maintainer and copied unchanged from the page. The aggregates below are recomputed from its
measured trials.

## Environment

| Field | Value |
|---|---|
| Date | 2026-09-28T03:11:37Z |
| AkariSP | `7e8202e`, `akarisp` 0.1.0-alpha.2, `dist/` built from that commit |
| Browser | Google Chrome 153.0.8010.53 |
| OS / hardware | macOS 15.7.4, arm, `hardwareConcurrency` 8, `deviceMemory` 16 |
| Prompt API | `availability()` = `available`; no flags set by the harness (none reported) |
| Run | 2 warmup rounds (excluded) + 10 measured rounds × 3 cases, 2 tasks each |

**Results are environment-specific. They characterize this Chrome, model and device combination
only.**

## Aggregate (REAL_BROWSER_PROMPT_API)

| Case | Limit | Tasks | Batch wall median | Task median | Prompt median | Queue median | Overlap median (ratio) | Errors |
|---|---|---|---|---|---|---|---|---|
| NC | — | 2 | 13986 ms | 10318 ms | 10318 ms | N/A | 8363 ms (1.00) | 0 |
| L1 | 1 | 2 | 11802 ms | 9022 ms | 5437 ms | 1854 ms | 0 ms (0) | 0 |
| L2 | 2 | 2 | 12688 ms | 9860 ms | 9856 ms | 0 ms | 6269 ms (1.00) | 0 |

- **Task median**: `settledAt − submitAt`.
- **Prompt median**: the native `prompt()` call lifetime.
- **Queue median**: `TaskTiming.queueWait`. For L1 it is the median of {0, the first task's
  duration} over all tasks.

## Paired by round

Each round's three cases ran back to back, so the within-round ratios below reduce drift between
rounds.

| Round | Order | L1 batch | L2 batch | NC batch | L2/L1 | NC/L1 | L1 mean prompt | L2 first done | L2 last done | L1 prompt sum |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | L2>NC>L1 | 10219 | 9438 | 11601 | 0.92 | 1.14 | 5108 | 5179 | 9437 | 10216 |
| 1 | NC>L1>L2 | 8189 | 9923 | 8428 | 1.21 | 1.03 | 4094 | 4431 | 9918 | 8187 |
| 2 | L1>L2>NC | 9450 | 10994 | 13166 | 1.16 | 1.39 | 4723 | 4783 | 10991 | 9447 |
| 3 | L2>NC>L1 | 8623 | 8571 | 14807 | 0.99 | 1.72 | 4310 | 3954 | 8567 | 8619 |
| 4 | NC>L1>L2 | 16723 | 14382 | 13098 | 0.86 | 0.78 | 8358 | 9876 | 14378 | 16717 |
| 5 | L1>L2>NC | 8813 | 9840 | 10450 | 1.12 | 1.19 | 4402 | 4664 | 9837 | 8804 |
| 6 | L2>NC>L1 | 21362 | 16722 | 22149 | 0.78 | 1.04 | 10675 | 8609 | 16714 | 21350 |
| 7 | NC>L1>L2 | 19797 | 20603 | 19381 | 1.04 | 0.98 | 9892 | 11709 | 20599 | 19785 |
| 8 | L1>L2>NC | 15666 | 16008 | 20326 | 1.02 | 1.30 | 7828 | 10457 | 15999 | 15656 |
| 9 | L2>NC>L1 | 13384 | 15819 | 16076 | 1.18 | 1.20 | 6688 | 7359 | 15796 | 13377 |

All times are in ms. "L2 first/last done" is measured from the first native `prompt()` start.

Medians of the per-round values:
- L2/L1 batch = **1.03** (range 0.78–1.21).
- NC/L1 batch = **1.17**.
- L2 first done / L1 mean prompt = **1.07**.
- L2 last done / L1 prompt sum = **1.03**.

## Findings

- **Call lifetimes overlap almost fully.** In L2 and NC the two native `prompt()` calls start
  within about 1 ms of each other. The shorter call lies entirely inside the longer one: overlap
  ratio 1.00 in 20/20 concurrent trials.
- **No batch benefit from L1 to L2.** L2's batch wall time is not lower than L1's: median paired
  ratio 1.03, with rounds on both sides of 1. Native `Promise.all` (NC) is not lower either.
- **The pattern looks like a sequential handoff inside the browser.** Under L2 the first call
  finishes in about the time of one prompt alone (1.07× L1's mean prompt). The second finishes
  in about the time of two prompts in a row (1.03× L1's sum). This matches the second call
  waiting inside `prompt()` rather than both progressing at a shared, slower rate. That reading
  is an inference from call lifetimes: no per-token timing was recorded.
- **Per-task latency.** The first finisher is essentially unchanged. The second finisher's
  completion time is about the same in L1 (`queueWait` + `prompt`) and L2 (all `prompt`). L2
  moves the wait from AkariSP's queue into the native call; it does not remove it.
- **Snapshots.**
  - L1: `active 1 / queued 1` right after submission in 10/10 trials, then `1/0`, then `0/0`.
  - L2: `active 2 / queued 0` in 10/10 trials, then `1/0`, then `0/0`.
  - No state other than `ready` was seen.
- **Errors**: 0 across warmups and trials: no rejection, `TaskError`, `DOMException`, or tab
  instability.
- **Order and drift.**
  - Durations roughly doubled for all cases in rounds 4 and 6–8. This is consistent with thermal
    or background drift, and output length also varies (310–598 characters).
  - The rotated order and the within-round ratios are the mitigation.
  - With 10 rounds, a small L2 benefit or penalty (±10%) cannot be ruled out.

## Verdict

**SERIALIZED-LIKE** (REAL_BROWSER_PROMPT_API). Two native task sessions had overlapping `prompt()`
call lifetimes, but batch wall time matched the sequential control. The completion pattern matches
one generation finishing before the other. This describes observed wall-clock behavior only, not
how Chrome or the hardware executes inference.

**Proves:** in this environment, `limit: 2` produced two active AkariSP tasks and two overlapping
native `prompt()` calls, with no material batch wall-time change against `limit: 1`, and no
errors.

**Does not prove:** anything about GPU or hardware parallelism, other devices, Chrome versions,
models or workloads (longer or streaming prompts, more than two tasks), or why Chrome behaves
this way.

## Finding F1 — native wait is reported as `prompt` time under `limit` > 1

| Field | Value |
|---|---|
| Scenario | Two concurrent `run()`s with `limit: 2` |
| Environment | Chrome 153.0.8010.53, macOS 15.7.4, arm |
| Observed | `snapshot()` `active 2 / queued 0`. The second task's `TaskTiming.prompt` (~9.9 s median) includes the time it apparently waited inside the browser; `queueWait` is 0 |
| Expected | Consistent with the contract: `prompt` is documented as the prompt phase, measured around `task.prompt()` |
| Reproduction | `index.html`, case L2 |
| Evidence class | REAL_BROWSER_PROMPT_API (timing), SOURCE_ANALYSIS (what `prompt` measures) |
| AkariSP contract involved | `TaskTiming.prompt`, `snapshot().active`/`queued` |
| Prompt API behavior involved | Concurrent `prompt()` calls on clones of one base |
| Application impact | With `limit` > 1, waiting becomes invisible to `queued`/`queueWait`, and a waiting task counts as `active` |
| Core change required? | NO |
| Confidence | Medium (one environment, 10 rounds) |

## L3/L4

Not run. L2 showed no batch benefit, so scaling up is not justified by this evidence.

## WebLLM comparison (resource and execution model, not speed)

- **WebLLM 0.2.85**: one shared engine with a per-model FIFO lock. The second generation's first
  chunk arrived after the first ended, and the lock is visible in the library source.
- **Prompt API in Chrome 153**: one warm base plus native clones. Both `prompt()` calls are accepted
  at once, and the completion pattern looks sequential.

In both, concurrent submissions end up executed one after another from the application's
wall-clock view. The difference is where the wait sits:
- WebLLM with `limit` 1: the wait stays in AkariSP's queue.
- Prompt API with `limit` 2: the wait sits inside the native call.

Versions, models and ownership differ, so this is not a speed comparison.

## Implications

- **AkariSP**:
  - This evidence gives no reason to raise the Prompt API default above `limit` 1. With
    `limit: 1`, waiting stays observable through `queued` and `queueWait`, and it stays cancellable
    in AkariSP's queue before any clone exists.
  - **Default limit change: not decided in this research.**
- **BrowserTradingAgents Feature 003**:
  - Application-level concurrent submission (Market + News fan-out) works with `limit: 1`: AkariSP
    queues the second task.
  - This environment showed no wall-time gain from `limit: 2`.
  - A workload-specific measurement would be needed before relying on higher concurrency.
  - No architecture decision is made here.
