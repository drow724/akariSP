# Implementation Plan: Runtime Snapshot

**Branch**: `003-runtime-snapshot` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-runtime-snapshot/spec.md`

## Summary

Expose state the scheduler already owns. `runtime.snapshot()` is one synchronous method on the
object returned by `createRuntime`, returning a fresh object literal
`{ state, active: running, queued: queue.length, limit, queueCapacity }` built from the existing
closure variables. There is no new bookkeeping, no refactor of `admit`, `release`, `drain`, or
`shutdown`, and no named `RuntimeState` export (`Runtime['state']` is reused). One new exported
type: `RuntimeSnapshot`.

## Technical Context

**Language/Version**: TypeScript 5.x → ES2022 ESM (unchanged)

**Primary Dependencies**: none at runtime (unchanged)

**Storage**: N/A

**Testing**: `node:test` with the existing fake `LanguageModel` (unchanged fake; `onDestroy`
hook used to observe cleanup in progress)

**Target Platform**: desktop Chrome Prompt API (unchanged)

**Project Type**: library

**Performance Goals**: no new claim; `snapshot()` is O(1)

**Constraints**: synchronous; side-effect free; no new counters or observability state; no
change to scheduling or lifecycle

**Scale/Scope**: `src/index.ts` about +15 lines (1 interface, 1 `Runtime` member with doc
comment, 1 method); tests appended to `test/runtime.test.ts`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Small Core | ✅ | Observability of existing scheduling state is in core scope; no framework |
| II. Browser Native First | ✅ | No provider interaction at all |
| III. Benchmark Driven | ✅ | No performance claim |
| IV. Minimal Overhead | ✅ | Zero cost when not called; O(1) read when called; no counters on hot paths |
| V. Explicit Lifecycle | ✅ | Counts are the lifecycle's own variables; no new lifecycle states |
| VI. Context Safety | ✅ | Not affected |
| VII. Framework Agnostic | ✅ | Plain object |
| VIII. No Premature Provider Abstraction | ✅ | Not affected |
| IX. Native Features Before Reinvention | ✅ | Relies on JS run-to-completion for consistency (research P2); no locks |
| X. Scope Discipline | ✅ | No metrics registry, events, subscriptions, or history (FR-211) |
| XI. Reliability Over Feature Count | ✅ | Read-only; cannot affect backpressure or cleanup |
| XII. Public API Stability | ✅ | +1 method (`snapshot`), +1 type (`RuntimeSnapshot`); `Runtime['state']` reused instead of a new `RuntimeState` name; internals (queue entries, slots) not exposed, only counts |

**Post-design re-check**: ✅ All gates pass; nothing in Phase 1 added state or exports.

## Project Structure

### Documentation (this feature)

```text
specs/003-runtime-snapshot/
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
src/index.ts             # + RuntimeSnapshot interface, + Runtime.snapshot(), + method in createRuntime
test/runtime.test.ts     # snapshot tests appended; 001/002 tests untouched
README.md                # short "Snapshot" section
```

**Structure Decision**: Single module, unchanged layout. The method closes over the variables it
reads, so it must live in `createRuntime`.

## Design Notes

### Authoritative fields read

`state`, `running`, `queue.length`, `limit`, `queueCapacity`. All are existing closure variables
(research P1). `running` is incremented only when a slot is granted and decremented only in
`release()`, after the task session is destroyed. This is exactly the FR-204 definition of
active, for `run()` and `stream()` alike.

### queued → active observation consistency

`release()` performs `running--`, then `running++` and `queue.shift()!()` in one synchronous
block, and `snapshot()` is synchronous. JavaScript run-to-completion means a snapshot runs wholly
before or after that block, so a task is never observed in both counts or in neither
(research P2). No lock or transaction is added.

### Shutdown and broken

These follow from existing code without changes:
- `shutdown()` sets `state = 'closed'` and drains the queue synchronously, so an immediate
  snapshot shows `closed`, `queued: 0`, and `active` equal to tasks still cleaning up.
- `await shutdown()` resolves only after `idle`, which fires when `running` reaches 0, so
  afterwards `active` is 0.
- A broken transition drains the queue (`queued: 0`) and leaves running tasks counted until they
  release.

### Regression risk

Low. The change is additive: new interface, new member, new method. Existing statements are not
edited. Gate: run the 62 existing tests unchanged before and after the change; `tsc` must pass;
`dist/index.d.ts` must show only the two new public names.

## Test Strategy

1. **Regression gate**: `npm test` = 62/62 before any change (already confirmed at plan time).
2. **Snapshot tests** (quickstart.md table), written before the implementation and appended to
   `test/runtime.test.ts`. The existing fake is used unchanged. Cleanup in progress and the
   slot handoff are observed by taking snapshots inside `fake.onDestroy`, which runs during the
   task's `destroy()`, before `release()`.
3. **Side-effect freedom**: 10,000 calls leave `fake.creates`, `clones`, and `destroys`
   unchanged, and a subsequent `run()` behaves normally.
4. **Bound validation**: a burst of 100 mixed `run`/`stream` tasks; a snapshot after every
   settle stays within limit and queue capacity and ends at 0/0.

## Complexity Tracking

No constitution violations; section intentionally empty.
