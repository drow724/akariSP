---

description: "Task list for 003-runtime-snapshot"
---

# Tasks: Runtime Snapshot

**Input**: Design documents from `/specs/003-runtime-snapshot/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/public-api.md,
quickstart.md; features 001 and 002 implemented

**Tests**: Included (spec independent tests, SC-202–SC-205). The implementation is one
expression, so the order follows the user's request: regression gate → implementation →
lifecycle tests.

**Organization**: All code is in `src/index.ts` and `test/runtime.test.ts`, so tasks are
sequential except where marked `[P]`. No observability layer, metrics manager, snapshot service,
inspector, or state tracker; there is nothing to build beyond one method and one type.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from spec.md (US1–US3)

---

## Phase 1: Foundational

- [X] T001 Regression gate: run `npm test` and `npx tsc --noEmit -p .` before any change; confirm 62/62 existing 001/002 tests pass with `test/runtime.test.ts` unmodified. Do not edit existing tests at any point in this feature
- [X] T002 In `src/index.ts` add the public type and method, reading only existing closure state (research P1). Add `export interface RuntimeSnapshot { state: Runtime['state']; active: number; queued: number; limit: number; queueCapacity: number }` with one-line doc comments per contract. Add `snapshot(): RuntimeSnapshot` to `Runtime` with a doc comment ("Synchronous, read-only view of current state. Never waits, never changes anything."). In the object returned by `createRuntime`, add `snapshot: () => ({ state, active: running, queued: queue.length, limit, queueCapacity })`. Do not add counters, metrics state, listeners, events, caches, subscriptions, locks, or transaction code; do not export a `RuntimeState` type (research P3); do not edit existing statements

**Checkpoint**: 62/62 still pass; `tsc` passes

---

## Phase 2: User Story 1 - Inspect current pressure (Priority: P1) 🎯 MVP

**Goal**: One immediate call reports state, active, queued, limit, queueCapacity

**Independent Test**: idle runtime reports `ready`, 0, 0 and the effective limit / capacity

- [X] T003 [US1] In `test/runtime.test.ts` append snapshot basics:
  - idle with defaults → `{ state: 'ready', active: 0, queued: 0, limit: 1, queueCapacity: 32 }` via `deepEqual` (FR-201, FR-206)
  - explicit `{ limit: 3, queueCapacity: 7 }` → `limit: 3`, `queueCapacity: 7`
  - `snapshot()` returns a plain object, not a Promise (`!(s instanceof Promise)`)
  - mutating a returned snapshot (`s.active = 99; s.state = 'closed'`) leaves a new snapshot and `runtime.state` unchanged, and two calls return different objects (FR-208)
  - fresh per call: take a snapshot, start a held `run()`, take another → the first still shows `active: 0`, the second `active: 1`

**Checkpoint**: MVP value available

---

## Phase 3: User Story 2 - Counts follow the real task lifecycle (Priority: P1)

**Goal**: `active` equals slot ownership and `queued` equals the waiting queue, for `run()` and `stream()`

**Independent Test**: one task observed through queued → active → cleanup → released, one through queued → cancelled; counts change only at those transitions

- [X] T004 [US2] In `test/runtime.test.ts` append active-lifecycle tests (FR-204):
  - held `run()` → `active: 1`; after release and completion → `active: 0`
  - `stream()` held after its first chunk → `active: 1`; after the loop ends → `active: 0`
  - `limit: 2` with one held `run()` and one held stream → `active: 2` (shared count)
  - **cleanup in progress**: set `fake.onDestroy` to take a snapshot during the task's own `destroy()`; it shows `active: 1` (slot not yet released). After the outcome settles, `active: 0`
  - paused stream consumer: pull one chunk, abort, `await tick()` → `active: 0` without another pull
- [X] T005 [US2] In `test/runtime.test.ts` append queue-lifecycle tests (FR-205):
  - `limit: 1`: held run A + queued run B → `active: 1, queued: 1`; held run A + a stream whose first pull waits → `queued: 1`
  - lazy stream: `runtime.stream('x')` never pulled → `active` and `queued` unchanged
  - capacity rejection: `limit: 1, queueCapacity: 1` full, a third `run()` rejected `'rejected'` → `queued` stays 1
  - queued cancellation: abort a waiting task → `queued` drops by 1 immediately after the abort (same tick, before awaiting its rejection)
  - **handoff consistency**: `limit: 1`, held A plus queued B and C (mixed run/stream), plus one lazy stream created but never pulled. Invariant: `active + queued` equals the number of tasks whose admission was accepted and that have not yet left the queue or released their slot. Counting rules: a `run()` counts from its accepted admission; a stream counts from the accepted admission of its first pull; a never-pulled lazy stream and an admission that failed (e.g. capacity rejection) never count; a task cancelled while queued stops counting at the moment it is removed from the queue; a task stops counting as active at the moment its slot is released. The caller-side promise resolve/reject microtask is **not** used as the boundary. Observe only at deterministic points: inside A's `destroy` (`fake.onDestroy`), after `await`ing a task's settle, and right after a synchronous admission or cancellation call returns. Do not infer counts from microtask timing just before or after a promise settles. Assert at every observation that the invariant holds, `active ≤ 1`, and B moves from queued to active with no observation counting it twice or not at all. Use the existing scheduler only; add no synchronization
  - saturated example: `limit: 2, queueCapacity: 32`, 2 held + 5 queued (mixed run/stream) → `active: 2, queued: 5` (US1/AC2)

**Checkpoint**: US1 + US2 pass

---

## Phase 4: User Story 3 - Safe in every lifecycle state (Priority: P2)

**Goal**: Snapshot works in `broken` and `closed`, and matches existing semantics

**Independent Test**: snapshots across a broken transition and a shutdown never throw and report the documented counts

- [X] T006 [US3] In `test/runtime.test.ts` append broken tests (FR-203):
  - `limit: 2, queueCapacity: 1`: A held on its own clone, B's clone rejects `InvalidStateError`, C queued before the transition → after B settles: `snapshot()` does not throw, `state: 'broken'`, `queued: 0`, `active: 1` (A)
  - taking snapshots does not change `fake.creates` (no recovery)
  - release A → `active: 0`, `state` still `'broken'`
- [X] T007 [US3] In `test/runtime.test.ts` append shutdown tests (FR-209):
  - held `run()` and one queued task; call `shutdown()` without awaiting → an immediate snapshot is `state: 'closed'`, `queued: 0`, `active: 1`
  - after `await` shutdown → `{ state: 'closed', active: 0, queued: 0 }`
  - snapshot after shutdown with a paused stream → `active: 0` once shutdown resolves

**Checkpoint**: all stories pass → MVP complete (T001–T007)

---

## Phase 5: Polish & Validation

- [X] T008 In `test/runtime.test.ts` append the SC-203 bound check: `limit: 2, queueCapacity: 4`, 100 mixed `run`/`stream` tasks (fake prompt/stream steps resolve after a tick; a few aborted). Take a snapshot after submission and on every task settle; each satisfies `active ≤ 2` and `queued ≤ 4`; after all settle → `active: 0, queued: 0`
- [X] T009 In `test/runtime.test.ts` append the SC-204 side-effect check (not a benchmark; no timing assertions): with one held `run()` and one queued task, record `fake.creates/clones/destroys`, `runtime.state`, and a snapshot; call `snapshot()` 10,000 times; all recorded values are unchanged; release and confirm both tasks and a subsequent `run()` succeed
- [X] T010 [P] In `README.md` add a short "Snapshot" section: `runtime.snapshot()` fields, synchronous and read-only, `active` includes tasks still cleaning up, closed after shutdown shows 0/0
- [X] T011 Final verification (SC-202 lifecycle coverage is met by the T003–T007 tests together, not by one single test): `npm test` all pass with 001/002 tests unmodified (`git diff` of the existing test lines is empty; only appended tests), `npx tsc --noEmit -p .` and `npm run build` pass, `dist/index.d.ts` gains exactly `snapshot` on `Runtime` and `RuntimeSnapshot`, `package.json` still has no `dependencies`

---

## Dependencies & Execution Order

- T001 → T002 → US1 (T003) → US2 (T004–T005) → US3 (T006–T007) → Polish (T008–T011)
- T010 (README) is the only `[P]` task; it can run anytime after T002
- US2 and US3 need no production changes; they verify existing semantics through T002

## Implementation Strategy

**MVP = T001–T007.** T002 is the entire production change; the story phases prove the counts
match the existing lifecycle in every state. Polish adds the stress (SC-203) and side-effect
(SC-204) validations, docs, and the final API check.

## Notes

- No new bookkeeping: `snapshot()` reads `state`, `running`, `queue.length`, `limit`,
  `queueCapacity`
- Public API delta: `Runtime.snapshot()` and `RuntimeSnapshot` only
