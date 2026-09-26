# Implementation Plan: Streaming Task Execution

**Branch**: `002-streaming-execution` | **Date**: 2026-09-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-streaming-execution/spec.md`

## Summary

Add `runtime.stream(input, options)` as a second prompt step on the **existing** task
lifecycle, not a new subsystem. The current `run()` body is split into three closure helpers
that both operations use: `admit` (state, pre-abort, slot/queue, combined signal), `acquire`
(clone with cancel/broken/failed mapping), and `end` (destroy, release slot, `total`).
`stream()` returns a small object with `timing` and an async-generator `[Symbol.asyncIterator]`
that awaits the same helpers, then iterates `session.promptStreaming()`.

Two things are streaming-only:
- an abort listener that cleans up while the consumer is paused at `yield`;
- publishing `stream.timing` only after cleanup.

Early `break` cleanup comes from the language: `return()` runs the generator's `finally`, and
leaving the inner `for await` cancels the provider stream.

## Technical Context

**Language/Version**: TypeScript 5.x → ES2022 ESM (unchanged)

**Primary Dependencies**: none at runtime (unchanged)

**Storage**: N/A

**Testing**: `node:test` with the existing fake `LanguageModel`, extended with
`promptStreaming`

**Target Platform**: desktop Chrome Prompt API (`promptStreaming` returns an async-iterable
`ReadableStream`)

**Project Type**: library

**Performance Goals**: no new claim; per-task overhead stays within 001 SC-002 for `run()`

**Constraints**: one scheduler; no new runtime options; one new public operation; `run()`
behavior unchanged

**Scale/Scope**: `src/index.ts` grows from ~173 to ~210 lines; tests appended to
`test/runtime.test.ts`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Small Core | ✅ | Streaming is a prompt-step variant of the existing task lifecycle; no agent concepts |
| II. Browser Native First | ✅ | Uses the provider's `promptStreaming()` directly |
| III. Benchmark Driven | ✅ | No performance claim is made; no benchmark change needed |
| IV. Minimal Overhead | ✅ | Chunks are passed through without buffering; one listener per streaming task |
| V. Explicit Lifecycle | ✅ | Every ending path is listed with the component that runs cleanup (data-model.md); cleanup is idempotent |
| VI. Context Safety | ✅ | Clone per streaming task; base never prompted |
| VII. Framework Agnostic | ✅ | Standard async iteration only |
| VIII. No Premature Provider Abstraction | ✅ | One more member on the local `Session` shape; no interface layer |
| IX. Native Features Before Reinvention | ✅ | Async generators, `for await`, the provider stream's own cancel on `return()`, `AbortSignal` |
| X. Scope Discipline | ✅ | No UI or framework adapters, callbacks, or metrics |
| XI. Reliability Over Feature Count | ✅ | Early exit, paused-consumer cancellation, and shutdown cleanup are designed before convenience features; TTFT deferred |
| XII. Public API Stability | ✅ | +1 method (`stream`), +1 type (`TaskStream`); no new options; no internals exposed |

**Post-design re-check**: ✅ All gates pass. The one design risk (a paused consumer blocking
shutdown) is handled by research S3 without new public surface.

## Project Structure

### Documentation (this feature)

```text
specs/002-streaming-execution/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/public-api.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/index.ts             # refactor run() into admit/acquire/end; add stream(); TaskStream type
test/runtime.test.ts     # fake promptStreaming + streaming tests appended; 001 tests untouched
README.md                # streaming usage section
```

**Structure Decision**: Stay in one module. The shared helpers are closures over the same
state (`queue`, `running`, `state`, `closer`), so splitting files would mean passing that state
around for no gain.

## Design Notes

### Implementation invariants

1. **Single-flight cleanup.** Each streaming task has one `cleanup()` that stores its Promise on
   the first call (`cleaning ??= (async () => { … })()`), and every caller awaits that same
   Promise: the abort listener, the generator's `finally`, and any error path. A boolean
   `done` guard is not used, because a later caller could return before the original cleanup
   finished. Today the steps are synchronous (`destroy()`, `release()`). The Promise keeps the
   contract correct if a step becomes asynchronous later.
2. **Paused-consumer cancellation does not wait for the generator.** Once the clone is
   obtained, an abort on the task signal (caller abort, timeout, or shutdown) calls `cleanup()`
   from the listener immediately. Resources are released even if the consumer never pulls
   again. The provider generation is stopped by the same signal (passed to
   `promptStreaming`) and by `destroy()`.
3. **Shutdown awaits cleanup, not the abort request.** `shutdown()` waits on the runtime's
   `idle` gate, which opens only when `release()` brings `running` to 0. `release()` is a step
   inside `cleanup()`, after the session is destroyed. `shutdown()` therefore resolves only
   after every active streaming task's cleanup has completed and its slot is released,
   including cleanups started by the listener outside the generator's control flow. This
   reuses the existing 001 mechanism; nothing new is added to `shutdown()`.

No public API or new abstraction is introduced for these rules. The mechanism is a per-task
Promise variable and the existing `idle` gate.

### Shared vs streaming-only

| Shared (existing logic, extracted once) | Streaming-only |
|---|---|
| state and pre-abort checks, admission, FIFO queue, `queueWait`, listener cleanup for waiters | async generator host object with `timing` |
| combined signal (`AbortSignal.any` of caller + runtime) | `used` single-use flag |
| clone, late-clone check, `InvalidStateError` → broken + drain, cancel/failed mapping, `acquire` timing | `for await` over `promptStreaming`, `yield` |
| destroy → release slot → `total` (`end`) | abort listener after clone for the paused consumer; single-flight `cleanup` Promise wrapper |
| `TaskError`, `TaskTiming`, shutdown, `idle` wait | `stream.timing` published in `cleanup` |

### Early break flow

consumer `break` → `iterator.return()` → generator resumes at `yield` with a return completion
→ inner `for await` exits → provider stream `return()` cancels generation → `finally` →
`await cleanup()`: remove listener, destroy session, release slot (the next waiter may start),
set `total`, publish `timing` → `return()` resolves → `break` completes. No error. `prompt` is
undefined.

### Cancellation / shutdown flow

- **Generator running** (awaiting a chunk): the provider rejects the pending `next()` →
  `catch` → `TaskError('cancelled', sig.reason)` → `finally` → `cleanup()`. The listener may
  have already started cleanup; `finally` awaits the same single-flight Promise.
- **Consumer paused at `yield`**: the abort listener starts `cleanup()` immediately, without
  waiting for the generator to resume. On the next pull the generator sees `sig.aborted`,
  awaits the same cleanup Promise, and throws `cancelled`.
- **Shutdown**: `closer.abort(AbortError)` → the above for every active stream → each
  `cleanup()` completes its `release()` → `running` reaches 0 → `idle` → base destroyed →
  `shutdown()` resolves (invariant 3). A stream whose clone is still
  pending takes the 001 late-clone path, then its `finally` releases the slot.
- **Before the clone**: no listener; the existing late-clone path keeps the slot until the late
  session is destroyed.

### Regression risk to 001

- **Refactor of `run()` into helpers**: the medium risk. Mitigation: extract without changing
  order of operations; all 36 existing tests must pass unchanged before streaming code is added.
- **`total` write moved from `fail()` to `admit()`/`end()`**: low risk. `run()` already
  overwrote `total` in `finally`; admission errors keep their `total`. Covered by the existing
  timing tests.
- **`Session` type gains `promptStreaming`**: type-only. The fake must add it; the base session
  object is untouched.

## Test Strategy

1. Refactor first, then run the 36 existing tests unchanged (gate).
2. Extend the fake `FakeSession` with `promptStreaming(input, { signal })`: an async generator
   over test-controlled chunks with optional hold points, error injection, and signal honoring.
   It records whether its `return()` ran (provider cancelled) and how many chunks were pulled.
3. Streaming tests per quickstart.md, written before the implementation (TDD), including the
   paused-consumer, early-break slot-handoff, mixed-queue, late-clone, and shutdown scenarios.
4. Timeout tests use the 001 pattern: attach handlers first, keep the event loop alive with
   `sleep`.

## Complexity Tracking

No constitution violations; section intentionally empty.
