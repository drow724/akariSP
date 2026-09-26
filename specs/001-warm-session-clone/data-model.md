# Data Model: Warm Base Session with Cloned Task Execution

All state is in memory. Nothing is persisted (FR-014).

## Runtime

| Field | Type | Notes |
|---|---|---|
| state | `'ready' \| 'broken' \| 'closed'` | Public, read-only (FR-011b) |
| base | provider session | Created once at init (FR-001); never prompted (FR-002) |
| policy | Concurrency Policy | Fixed for the runtime's lifetime |
| running | count + set of running-task promises | A running task holds a slot from before its clone starts until its task session (if any) is destroyed; count ≤ limit |
| queue | FIFO of waiting tasks | Length ≤ `policy.queueCapacity`; each entry holds its caller-signal abort handler for explicit removal |
| controller | runtime-owned abort controller | Aborted by shutdown (research R3) |
| closing | `Promise<void>` or unset | Stored by the first `shutdown()` call; returned by every later call |

**State transitions**

```text
          clone fails with InvalidStateError
 ready ───────────────────────────────────────▶ broken
   │                                              │
   │ shutdown()                                   │ shutdown()
   ▼                                              ▼
 closed ◀─────────────────────────────────────────┘
```

- No transition back to `ready`; the application creates a new runtime.
- `broken` means the base can no longer be trusted for new tasks, not that it was
  necessarily reclaimed (research R2).
- On entering `broken`: current task fails (`code: 'broken'`, `cause` = clone error),
  all waiters are rejected (`code: 'broken'`), tasks already holding a task session keep
  running and may succeed. Their slots are released normally; no waiter is started.
- In `broken` or `closed`: `run()` rejects immediately (`code` = current state).

## Concurrency Policy

| Field | Type | Default | Validation |
|---|---|---|---|
| limit | integer | 1 | ≥ 1; absolute cap on running tasks |
| queueCapacity | integer | 32 | ≥ 0, finite |

Overflow is always reject in v0.1; no option exists for it. Invalid values make
`createRuntime()` reject with a `TypeError` before the base session is created.

**Admission rule for `run()`** (state `ready`):

1. `running < limit` → start now.
2. else `queue.length < queueCapacity` → enqueue (FIFO).
3. else → reject `code: 'rejected'`.

When a running task releases its slot (after its task session is destroyed), the head of
the queue becomes a running task.

## Task (internal)

| Field | Notes |
|---|---|
| input | Prompt input, passed through to `prompt()` |
| signal | `AbortSignal.any([callerSignal, runtime.controller.signal])` |
| session | Task session; set after clone resolves, destroyed exactly once (FR-004) |
| t0 … t3 | `performance.now()` marks: submit, start, cloned, prompted |

**Task lifecycle**

```text
submitted ─▶ waiting ─▶ ┌──────────── running task (holds a slot) ────────────┐
                        │ slot acquire → clone → prompt → destroy → release   │ ─▶ done(success)
                        └──────────────────────────────────────────────────────┘
    │           │                 │ any step
    └───────────┴─────────────────┴──▶ done(failed | cancelled | rejected | closed | broken)
```

- Leaving `waiting` for any reason (start, abort, shutdown, broken) removes the caller-signal
  abort listener (research R4).
- If the signal aborts while `clone()` is pending and `clone()` later resolves: clone resolve
  → task session destroy → slot release → `cancelled` delivered; `prompt()` is not called
  (research R3). A task's promise never settles before its own cleanup is done (FR-009b).
- A running task cancelled by shutdown has `cause.name === 'AbortError'`; by a caller timeout,
  `cause.name === 'TimeoutError'`.

Exactly one terminal outcome per task. The task session, if created, is destroyed in a
single `finally` path; destroy errors are swallowed (spec edge case).

## Task Timing

| Field | Unit | Present when |
|---|---|---|
| queueWait | ms | time from entering the queue to leaving it for any reason (became a running task, caller cancellation, shutdown `'closed'`, broken `'broken'`); 0 if the task became a running task without queueing; undefined if the task never entered the queue (immediate `'rejected'`, pre-aborted, or submitted while `'broken'`/`'closed'`) |
| acquire | ms | clone resolved with a session (also when the task is then cancelled); undefined if clone rejected |
| prompt | ms | prompt resolved |
| total | ms | always, on every outcome (success, failed, cancelled, rejected, closed, broken) |

Overhead (SC-002) = `total − queueWait − acquire − prompt` on successful tasks.

## TaskError

| Field | Type | Notes |
|---|---|---|
| code | `'failed' \| 'cancelled' \| 'rejected' \| 'closed' \| 'broken'` | Outcome kind |
| cause | unknown | Original error (`failed`, `broken`) or abort reason (`cancelled`) |
| timing | Partial Task Timing | Fields per table above |
