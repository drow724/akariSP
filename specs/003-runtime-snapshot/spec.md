# Feature Specification: Runtime Snapshot

**Feature Branch**: `003-runtime-snapshot`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Add runtime snapshot support to AkariSP: one synchronous,
read-only `runtime.snapshot()` returning the current lifecycle state, active and queued task
counts, and the effective limit and queue capacity, derived from the runtime's existing
state. Not a metrics or observability framework."

## User Scenarios & Testing *(mandatory)*

The primary user is an **application developer** using the AkariSP runtime (features 001
and 002) who wants to see current runtime pressure and lifecycle state, for example to show
"2 running, 5 waiting" in a UI or to decide whether to submit more work, without reaching
into AkariSP internals. The snapshot only reports what the runtime already knows; it never
changes behavior.

### User Story 1 - Inspect current pressure (Priority: P1)

A developer asks the runtime for a snapshot at any moment and immediately receives the
lifecycle state, how many tasks currently hold a concurrency slot, how many are waiting in
the queue, and the effective limit and queue capacity.

**Why this priority**: This is the entire user value of the feature.

**Independent Test**: With limit 2 and queue capacity 32, hold 2 running tasks and queue 5
more; the snapshot reports state ready, 2 active, 5 queued, limit 2, queue capacity 32.

**Acceptance Scenarios**:

1. **Given** an idle ready runtime, **When** a snapshot is taken, **Then** it reports state
   ready, 0 active, 0 queued, and the effective limit and queue capacity (defaults included
   when not configured).
2. **Given** 2 tasks holding slots and 5 waiting, **When** a snapshot is taken, **Then** it
   reports 2 active and 5 queued.
3. **Given** normal and streaming tasks mixed, **When** a snapshot is taken, **Then** both
   kinds contribute to the same active and queued counts.
4. **Given** any runtime, **When** a snapshot is taken, **Then** the result is returned
   immediately (not deferred) and taking it changes nothing about the runtime.

---

### User Story 2 - Counts follow the real task lifecycle (Priority: P1)

The counts exactly follow slot ownership and queue membership as the existing lifecycle
defines them, so a developer is never misled about capacity.

**Why this priority**: A snapshot that disagrees with actual admission behavior is worse
than none (Constitution Principle V, XI).

**Independent Test**: Walk one task through queued → running → cleanup → done and one
through queued → cancelled, taking a snapshot at each step; counts change only at the
moments the task enters or leaves the queue or acquires or releases its slot.

**Acceptance Scenarios**:

1. **Given** a created but never-consumed stream, **When** a snapshot is taken, **Then**
   active and queued are unchanged by that stream.
2. **Given** a stream whose first pull is waiting behind the limit, **When** a snapshot is
   taken, **Then** it counts as queued.
3. **Given** a submission rejected because the queue is full, **When** a snapshot is taken,
   **Then** it never appears in queued.
4. **Given** a queued task cancelled before acquiring a slot, **When** a snapshot is taken
   afterward, **Then** it is no longer counted in queued.
5. **Given** a task whose model work has ended but whose task session is still being
   cleaned up, **When** a snapshot is taken, **Then** it is still counted as active until
   its slot is released.
6. **Given** a queued task that acquires a slot, **When** a snapshot is taken, **Then** it
   has moved from queued to active with no moment where it counts as both or neither.

---

### User Story 3 - Safe in every lifecycle state (Priority: P2)

A developer can take a snapshot whether the runtime is ready, broken, or closed, and the
state it reports matches the runtime's public state.

**Why this priority**: Diagnostics are most needed exactly when the runtime is broken or
shutting down.

**Independent Test**: Take snapshots before and after a broken transition and after shutdown;
none throws, state matches, and after completed shutdown both counts are 0.

**Acceptance Scenarios**:

1. **Given** a runtime that became broken, **When** a snapshot is taken, **Then** state is
   broken, queued is 0 (waiting tasks were rejected), and active counts tasks still running
   on their own task sessions.
2. **Given** a runtime whose shutdown has completed, **When** a snapshot is taken, **Then**
   state is closed and active and queued are both 0.
3. **Given** a snapshot, **When** the caller changes its fields, **Then** the runtime and any
   later snapshot are unaffected.

---

### Edge Cases

- Snapshot taken while shutdown is in progress: state is closed, queued is 0, and active may
  still be above 0 until running tasks finish cleanup; it reaches 0 once shutdown completes.
- A paused streaming consumer whose task was cancelled: its cleanup already released the slot,
  so it is no longer active even though the consumer has not yet observed the error.
- A task handed a slot by another task's release but not yet resumed: it counts as active
  (it owns the slot), not queued.
- Snapshot taken inside a task's own code path (e.g. within a stream loop body): allowed and
  returns immediately.
- Many snapshots in a tight loop: each is independent and has no effect on the runtime.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-201**: The runtime MUST provide one operation that synchronously returns a snapshot
  containing: lifecycle state, active count, queued count, limit, and queue capacity.
- **FR-202**: Taking a snapshot MUST NOT wait, create or clone sessions, admit, start, or
  cancel tasks, process the queue, or change any runtime state.
- **FR-203**: The snapshot's state MUST equal the runtime's public lifecycle state at the time
  of the call, and taking a snapshot MUST succeed in the ready, broken, and closed states.
- **FR-204**: The active count MUST equal the number of tasks currently holding a concurrency
  slot, under the existing slot lifecycle (slot acquired before clone, released only after
  the task session, if any, is destroyed), for both normal and streaming tasks.
- **FR-205**: The queued count MUST equal the number of tasks currently in the waiting queue,
  for both normal and streaming tasks. Never-consumed streams, rejected submissions, and
  queued tasks that were cancelled, rejected by shutdown, or rejected by a broken transition
  MUST NOT be counted.
- **FR-206**: The limit and queue capacity MUST be the effective values the runtime uses,
  including defaults applied when not configured.
- **FR-207**: Counts MUST be read from the runtime's existing authoritative state (its slot
  accounting and waiting queue), not from separately maintained observability counters.
- **FR-208**: Each call MUST return an independent value; modifying a returned snapshot MUST
  NOT affect the runtime or other snapshots.
- **FR-209**: After shutdown has completed, a snapshot MUST report state closed with active 0
  and queued 0.
- **FR-210**: Existing behavior of running tasks, streaming, shutdown, the public state, task
  errors, and task timing MUST remain unchanged, and all existing tests MUST pass unmodified.
- **FR-211**: The feature MUST NOT add cumulative or historical statistics, latency figures,
  event listeners, callbacks, subscriptions, polling helpers, timestamps, task identifiers,
  health scores, a metrics registry, or runtime dependencies.

### Key Entities

- **Runtime Snapshot**: A point-in-time, independent record of the runtime's state: lifecycle
  state (ready, broken, closed), active count, queued count, limit, queue capacity. It holds
  no references into the runtime.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-201**: A developer can read current state, active, queued, limit, and queue capacity
  with a single immediate call and no knowledge of internals.
- **SC-202**: Across a scripted sequence covering admission, queuing, slot handoff, cleanup,
  cancellation, rejection, broken transition, and shutdown, 100% of snapshots match the
  expected active and queued counts at every step.
- **SC-203**: Under a burst of at least 100 mixed normal and streaming tasks, every snapshot
  taken during the burst satisfies active ≤ limit and queued ≤ queue capacity, and after the
  burst settles both counts are 0.
- **SC-204**: Taking 10,000 snapshots in a row causes no change in runtime behavior or state.
- **SC-205**: All existing 001 and 002 tests pass without modification.
- **SC-206**: The feature adds exactly one public operation, no runtime dependencies, and no
  event, subscription, or metrics mechanism.

## Assumptions

- Builds on features 001 and 002; their lifecycle, queue, and state rules are unchanged.
- The state value uses the runtime's existing public lifecycle state values; whether this is
  surfaced as a named public type is decided in planning.
- A snapshot is not atomic with respect to concurrent task progress; it reflects the state
  at the moment of the synchronous call.
- Returning a fresh plain value per call is sufficient for independence; no deep freezing.
- No performance claim is made; no benchmark change is needed (Constitution III).
