# Template startup: pre-feature research (closed)

Candidate: `template-startup-scaling-validation`. Researched 2026-09-27.

**Decision: DO NOT START FEATURE 012 — SEQUENTIAL STARTUP REMAINS JUSTIFIED.** No spec was
created, and feature number 012 stays free.

## Question

Would concurrent template/base creation materially reduce AkariSP startup latency enough to
justify added lifecycle complexity?

## Evidence classes

### STATIC_CODE_ANALYSIS

`src/core/runtime.ts` creates bases sequentially:
- It validates options.
- If `session` is given, or `templates` is not, it runs `await provider.create(session)`.
- It then runs `await provider.create(config)` for each named template, in `Object.entries()`
  order.
- The runtime resolves only after every base exists.
- On a failure, already-created bases are destroyed in insertion order. A destroy failure is
  ignored, `provider.close()` is not called, and the original create error is rejected.
  Existing tests in `test/runtime.test.ts` ("templates: partial creation rolls back…", "rollback
  includes the default base…") protect this.

Sequential creation gives, by construction:
- at most one pending create at a time;
- the first failure is the error that is returned;
- no create resolving after the rejection;
- simple cleanup reasoning at the moment of rejection.

**Provider topology:**
- **Prompt API**: calls `LanguageModel.create()` once per base, creating one native warm base per
  template.
- **WebLLM**: `create: async (config = {}) => config` (`src/webllm/runtime.ts`). A template is
  request configuration only, and the single engine is injected by the application.

The startup question therefore concerns the Prompt API provider only.

### DETERMINISTIC_STAND_IN

This class runs `sequential.mjs` against `results: sequential-results-2026-09-27.json`.

- **Setup**: a fake `LanguageModel` whose `create()` waits a fixed delay D (0, 10, 50, 100, or
  250 ms), measuring the unmodified `src/` sequential code.
- **Base counts**: N = 1, 2, 4, 8, 16. "Bases" means named templates, with no default session.
- **Sampling**: 3 warmup runs and 15 measured runs. Timing uses `performance.now()`.
- **Environment**: Apple M1 (8 cores), Node 23.9, `src/` at `c762dc7`.

| Bases | D | Expected (N×D) | Median startup | Non-create time, median |
|---:|---:|---:|---:|---:|
| 1 | 100 ms | 100 | 101.11 | 0.03 ms |
| 4 | 100 ms | 400 | 403.58 | 0.07 ms |
| 16 | 100 ms | 1600 | 1615.21 | 0.22 ms |
| 16 | 250 ms | 4000 | 4017.85 | 0.39 ms |

- **What this shows**: startup follows N × D. The gap to the expected value is mostly timer
  lateness inside `create()`. The time spent outside `create()`, which is AkariSP's
  orchestration, is below 1 ms, at the level of benchmark noise.
- **What this is**: a characterization of summed provider cost, not a defect.
- **Reproducibility**: a re-run on the same machine reproduced the medians within about 1–2 ms.
  The committed JSON is the original run, unedited.

### REAL_BROWSER

This class runs `prompt-api.html` and `prompt-api.js` against
`results: prompt-api-results-2026-09-27.json`.

- **Environment**: Chrome 152 on macOS, 8 cores and 16 GB, with `LanguageModel.availability()`
  returning `"available"`. The page refuses any other state, so it never starts a download.
- **Sampling**: one warmup create and destroy (model load excluded), then 5 runs per condition.
- **Instrumentation**: the page wraps `LanguageModel.create` only to timestamp calls; AkariSP is
  unmodified.
- **Comparison column**: `Promise.all` of raw `LanguageModel.create()` calls is measured
  **outside AkariSP**.

| Bases | AkariSP sequential median (min–max) | Native `Promise.all` median (min–max) |
|---:|---:|---:|
| 1 | 169.8 ms (161.5–211.4) | 162.4 ms (158.3–166.1) |
| 2 | 322.0 ms (319.4–355.1) | 320.4 ms (312.0–357.5) |
| 4 | 676.9 ms (637.1–758.5) | 629.3 ms (626.7–633.8) |

- **Per-create cost**: about 160–170 ms (median). AkariSP's non-create time is about 0.1 ms.
- **Concurrent creates**: in the measured Chrome 152 environment, concurrent `create()` calls
  showed no material startup benefit. Four concurrent creates took about 3.9 times one create.
- **The 4-base difference**: 629.3 ms against 676.9 ms is real in the numbers. It is not "0%",
  but it lies within the observed range of the sequential runs. It is not treated as evidence
  strong enough to justify added lifecycle complexity.
- **No claim is made about how the browser handles concurrent creates internally.**

### HISTORICAL

`bench/results/2026-09-26-macos-8c-16gb-chrome152*.json` recorded a cold `create()` median of
207–223 ms with the model already loaded. That is the same order as the measurements above.

### HYPOTHETICAL_UPPER_BOUND

- **Ideal parallelism**: it would turn N × D into D. At N = 4 and D = 160 ms that is 640 → 160 ms,
  a 75% saving.
- **In practice**: this bound was **not** observed in the measured Chrome 152 environment (see
  REAL_BROWSER).

### NO_CONSUMER_EVIDENCE

No consumer has reported template startup latency as a problem, and no product failure has been
observed. The repository has no evidence of typical template counts. The source's ponytail
comment is not consumer evidence.

## Findings

- Startup on the sequential path is approximately linear in the number of bases
  (DETERMINISTIC_STAND_IN, REAL_BROWSER).
- Almost all of the cost is the provider's `create()`. AkariSP's orchestration overhead is very
  small, below 1 ms.
- WebLLM does not share this resource model: its templates are configuration only
  (STATIC_CODE_ANALYSIS).
- In the measured Chrome 152 environment, concurrent `create()` gave no material speedup
  (REAL_BROWSER).
- Parallel creation would add cleanup and ownership states that sequential creation does not
  have:
  - creates still pending when another fails;
  - choosing among multiple errors;
  - deciding when to destroy successful bases;
  - cleanup ownership for creates that resolve late;
  - creates and destroys running concurrently;
  - destroy failures;
  - whether to wait for pending creates before rejecting, which affects the current "0 resources
    at rejection" guarantee from 001 and 004;
  - resource pressure from concurrent native creates.
- There is no consumer evidence.

## Decision

Current evidence does not justify parallelizing template initialization. Sequential initialization
remains the intentional design: the measured Chrome 152 concurrency did not give a material
startup improvement, while parallel creation would materially complicate the cleanup and
resource-ownership guarantees.

This is not a claim that parallelism can never help.

## Revisit conditions

Reopen this as a new research or feature candidate only with new evidence. Any of these counts:

1. A consumer reports template startup latency as a problem.
2. There is evidence that common workloads use enough templates or bases for startup to matter.
3. A Prompt API implementation change makes concurrent `create()` give a meaningful wall-clock
   improvement.
4. A provider offers cancellation or resource-ownership primitives that substantially reduce the
   cleanup complexity.
5. A new provider creates an expensive, independent resource per template, and a concurrency
   benefit is measured for it.

## Reproduce

```bash
# Deterministic stand-in (Node ≥ 22.18, repository root). Measures src/ directly.
node experiments/template-startup/sequential.mjs > sequential-results-<date>.json
```

```bash
# Real browser: Chrome with the Prompt API model already available.
npm run build
python3 -m http.server 8080
# Open http://localhost:8080/experiments/template-startup/prompt-api.html, press Run, then Copy JSON.
```

The real-browser JSON was copied from the page by the maintainer and saved as
`prompt-api-results-2026-09-27.json`. Its values are unchanged; only whitespace was condensed.
