# Data Model: Streaming Task Execution

Extends `specs/001-warm-session-clone/data-model.md`. Runtime, Concurrency Policy, queue,
slot, TaskError, and TaskTiming are unchanged and shared.

## Stream (new, returned by `runtime.stream()`)

| Field | Type | Notes |
|---|---|---|
| timing | `TaskTiming \| undefined` | `undefined` until the task has fully ended and been cleaned up; then the final timing, identical to `TaskError.timing` on failure |
| `[Symbol.asyncIterator]` | async generator | Lazy; single-use (`used` flag) |

Internal per-task state (inside the generator): `t0`, `timing`, `sig` (combined signal),
`task` (session), `cleaning` (single-flight cleanup Promise).

## Streaming task lifecycle

```text
created ──(no pull)──▶ (nothing: no queue entry, slot, or session)
   │ first next()
   ▼
admission (shared) ──▶ waiting ──▶ running task ───────────────────────────────▶ ended
                                   slot → clone → promptStreaming → yield… → cleanup
```

Ending paths and who runs `cleanup()` (destroy session → release slot → set `total` →
publish `timing`):

| Path | Trigger | Runs cleanup | Consumer sees |
|---|---|---|---|
| Model finishes | inner loop ends | generator `finally` | loop ends normally |
| Model error | inner `next()` rejects | generator `finally` | `TaskError('failed', cause)` |
| Consumer `break` / `return()` | `return()` at `yield` → inner iterator `return()` cancels provider stream | generator `finally`; `return()` resolves after | nothing (no error) |
| Caller abort / timeout, generator running | provider rejects | generator `finally` (listener may run first) | `TaskError('cancelled', reason)` |
| Caller abort / timeout, consumer paused at `yield` | abort listener | listener, immediately | `TaskError('cancelled', reason)` on next pull |
| Shutdown | runtime signal aborts | listener or `finally` | `TaskError('cancelled', AbortError)` |
| Abort before clone resolves (late clone) | existing 001 path | generator `finally` after late session arrives | `TaskError('cancelled')` |
| Clone `InvalidStateError` | shared `acquire` | generator `finally` | `TaskError('broken')` |

`cleanup()` is single-flight: the first call stores its Promise and every caller awaits that
same Promise (no boolean guard). The listener is registered only after the clone is obtained,
starts cleanup without waiting for the generator, and is removed inside `cleanup()`.
`shutdown()` resolves only after each cleanup's `release()` has run (existing `idle` gate).

## Timing (streaming)

| Field | Set when |
|---|---|
| queueWait | same as 001 |
| acquire | clone resolved with a session |
| prompt | model's stream ended normally (not on early exit, cancel, or failure) |
| total | always; written by admission errors or by `cleanup()` |
