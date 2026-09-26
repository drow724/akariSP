# Implementation Plan: Warm Base Session with Cloned Task Execution

**Branch**: `001-warm-session-clone` | **Date**: 2026-09-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-warm-session-clone/spec.md`

## Summary

A single-module, zero-dependency TypeScript library. `createRuntime()` creates one warm base
session via the browser's `LanguageModel.create()`. `runtime.run()` admits the task through
a bounded concurrency gate (hard `limit`, FIFO queue, reject when full), clones the base,
prompts the clone with a combined `AbortSignal`, destroys the clone in one `finally`, and
returns the output with `performance.now()` phase timing. Non-success outcomes reject with a
single `TaskError` carrying `code`, `cause`, and partial timing. A clone `InvalidStateError`
moves the runtime to `broken` (base no longer trusted for new tasks; tasks already holding a
clone keep running); `shutdown()` is idempotent, cancels everything, and resolves only after
all sessions are destroyed. A static browser page benchmarks cold (`create → prompt →
destroy`) against warm (`clone → prompt → destroy`) on the same workload, reporting the warm
base's one-time creation cost separately so the result shows amortization, not
elimination, of session initialization.

## Technical Context

**Language/Version**: TypeScript 5.x, compiled to ES2022 ESM with `.d.ts`

**Primary Dependencies**: none at runtime; `typescript` as the only dev dependency

**Storage**: N/A (in-memory only; FR-014)

**Testing**: Node built-in `node:test` running `.ts` via native type stripping
(Node ≥ 22.18 / ≥ 23.6) against a fake `globalThis.LanguageModel`

**Target Platform**: Desktop Chrome with the Prompt API (`LanguageModel` global)

**Project Type**: library (+ standalone browser benchmark page)

**Performance Goals**: runtime overhead median < 1 ms per task (SC-002); warm acquisition
≥ 10× faster than cold create at the median (SC-001; measured baseline ~0.24 ms vs ~225 ms).
The warm base's one-time creation (~one cold create) is amortized over repeated tasks and
reported separately.

**Constraints**: zero runtime dependencies; no framework imports; hard concurrency cap
(default 1); bounded queue (default 32); overflow reject only

**Scale/Scope**: one module (~200 LOC), one test file, one benchmark page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Small Core | ✅ | Only lifecycle, scheduling, queueing, timing. No agent concepts. |
| II. Browser Native First | ✅ | Uses the `LanguageModel` global directly; no external runtime. |
| III. Benchmark Driven | ✅ | `bench/` page measures cold vs warm incl. one-time base create; claims framed as amortization; results saved with env details. |
| IV. Minimal Overhead | ✅ | Overhead measured per task (`total − queueWait − acquire − prompt`); no abstraction layers. |
| V. Explicit Lifecycle | ✅ | Single owner per clone; one `finally` destroy; documented runtime/task state machines. |
| VI. Context Safety | ✅ | Every task gets a fresh clone; no pool; base never prompted. |
| VII. Framework Agnostic | ✅ | Zero runtime deps. |
| VIII. No Premature Provider Abstraction | ✅ | No provider interface; local 4-member type only. |
| IX. Native Features Before Reinvention | ✅ | `AbortSignal.any`, `AbortController`, `performance.now`, `Promise.allSettled`, `Error.cause`. |
| X. Scope Discipline | ✅ | Benchmark lives outside `src/`; no adapters. |
| XI. Reliability Over Feature Count | ✅ | Backpressure (hard cap + bounded queue + reject), cancellation, deterministic and idempotent cleanup delivered; caller-runs and streaming deferred. |
| XII. Public API Stability | ✅ | Runtime surface: `createRuntime`, `run`, `shutdown`, `state`, `TaskError` (+ option/result types). Queue/slots/base not exposed. |

**Post-design re-check (after Phase 1)**: ✅ All gates still pass. The contract adds no
exports beyond the list above. Design review (2026-09-26) removed `caller-runs` and the
`overflow` option, shrinking `RuntimeOptions` to `session`, `limit`, `queueCapacity`.

## Project Structure

### Documentation (this feature)

```text
specs/001-warm-session-clone/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── public-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
package.json             # "type": "module", scripts: build (tsc), test (node --test)
tsconfig.json
src/
└── index.ts             # createRuntime, Runtime, TaskError, types (single module)
test/
└── runtime.test.ts      # node:test + fake LanguageModel
bench/
├── index.html           # Run button + JSON output
├── bench.js             # imports ../dist/index.js; cold vs warm
└── results/             # saved benchmark JSON (committed)
```

**Structure Decision**: Single package, single source module. The runtime is small enough
that splitting into queue/session/timing files would add imports without reducing
complexity; split when a file passes a size where navigation, not structure, hurts. The
benchmark is a static page outside `src/` so it never ships in the package (Principle X).

## Complexity Tracking

No constitution violations; section intentionally empty.
