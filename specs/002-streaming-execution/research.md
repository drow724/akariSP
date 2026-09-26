# Research: Streaming Task Execution

Builds on `specs/001-warm-session-clone/research.md` (R1–R9). Only new decisions are listed.

## S1. Async generator vs custom AsyncIterator

- **Decision**: Implement the stream's `[Symbol.asyncIterator]` as an **async generator
  method** on a small object that also carries `timing`.
- **Comparison**:

  | Concern | Async generator | Custom AsyncIterator |
  |---|---|---|
  | Consumer `break` / `iterator.return()` | Built in: `return()` resumes the generator at its paused `yield`, runs `finally`, and resolves only after `finally` finishes | Hand-written `return()` must track state and await cleanup |
  | Inner provider stream on early exit | Leaving the inner `for await` calls the provider iterator's `return()`, which cancels the provider stream automatically | Must call `reader.cancel()` manually |
  | Lazy start | Body does not run until the first `next()`; `return()` before `next()` never runs it (verified in Node 23) | Must guard manually |
  | Concurrent `next()` calls | Queued by the language | Must queue manually |
  | `timing` property | On the host object | On the host object |
  | Cancellation while consumer is paused at `yield` | Needs an abort listener (below) | Needs the same listener |
  | Sharing with `run()` | Awaits the same admission/clone/cleanup helpers | Same, plus a hand-rolled state machine |

  The generator gives cleanup-before-settle on `break` for free (verified in Node: provider
  cancel → `finally` cleanup → `break` completes).
- **Alternatives rejected**: custom iterator (~40 more lines reimplementing what the
  language does); `ReadableStream` as the public type (adds `getReader`, locking, and tee
  semantics the spec doesn't need); EventEmitter / callbacks (excluded by FR-115).

## S2. Shared lifecycle with `run()`

- **Decision**: Split the current `run()` body into three closure helpers inside
  `createRuntime`, used by both `run()` and `stream()`:
  1. `admit(signal)` → `{ t0, timing, sig }` or throws `TaskError`: state check, pre-abort
     check, admission (slot or queue wait), `queueWait`, and the combined signal
     `AbortSignal.any([caller, runtime])`. Sets `timing.total` on the errors it throws.
  2. `acquire(sig, timing)` → session: `clone({ signal })` with the existing error mapping
     (`cancelled` / `broken` + drain / `failed`) and `acquire` timing. Also the
     "broken while waiting" check.
  3. `end(task, t0, timing)`: destroy the session (swallow errors), `release()` the slot, set
     `timing.total`.
  The late-clone check (`if (sig.aborted)` after the clone) stays at the call site, because the
  caller must own the session variable before throwing so that `end()` destroys it.
- **Rationale**: One admission path, one queue, one slot counter, one broken transition, one
  cleanup. `stream()` differs from `run()` only in the prompt step and the paused-consumer
  listener (S3). No second scheduler (spec FR-104).
- **Regression guard**: The 36 existing tests run unchanged against the refactored `run()`
  (SC-105).

## S3. Cancellation while the consumer is paused (FR-109)

- **Problem**: A generator runs only while a `next()` is pending. If the consumer stops pulling,
  the generator stays suspended at `yield`, so the provider abort cannot reach `finally`.
  Shutdown would then wait forever for the slot.
- **Decision**: After the clone is obtained, register one `abort` listener on the task's
  combined signal that starts the task's `cleanup` (destroy session, release slot, set
  `total`, publish `stream.timing`) immediately, without waiting for the generator to resume.
  `cleanup` is **single-flight**: the first call stores its Promise (`cleaning ??= …`), and the
  listener, the generator's `finally`, and error paths all receive and await that same
  Promise. No boolean guard lets a later caller return early. The listener is removed inside
  `cleanup`.
- **Shutdown**: waits on the existing `idle` gate, which opens only when `release()` (the last
  resource step in `cleanup`) brings `running` to 0. It therefore awaits cleanups started by
  the listener, not merely the abort request.
- **Why only after the clone**: Before the clone resolves, the generator is running (awaiting
  the clone), not paused, so the existing late-clone path handles it and the slot must stay
  held until the late session is destroyed (FR-105, FR-110). Releasing the slot from a
  listener before the session exists would break that.
- **Consumer view**: When the paused consumer pulls again, the generator resumes, sees
  `sig.aborted`, and throws `TaskError('cancelled', cause = sig.reason)`. The cleanup has
  already happened.
- **Ceiling**: Relies on the provider settling the stream after abort (001 assumption).

## S4. Early exit semantics

- **Decision**: A consumer `break` or `return()` is not an error. Leaving the generator from
  `yield` triggers the inner `for await` exit, which cancels the provider stream, then
  `finally → cleanup()`. `return()`, and therefore the `break`, resolves after cleanup.
  `timing.prompt` stays undefined because the model did not finish.
- **No caller-visible abort reason**: The runtime does not abort the task signal on early exit.
  Cancelling the provider stream through its iterator is enough, and aborting a shared caller
  signal is not the runtime's call.

## S5. Timing publication (FR-113)

- **Decision**: `stream.timing` starts `undefined` and is assigned the task's timing object
  inside `cleanup()`, after destroy and release. For failures before admission completes
  (`rejected`, `closed`, `broken`, pre-aborted, cancelled while queued), the generator assigns
  `stream.timing = error.timing` before rethrowing. The same object is carried by `TaskError`,
  so the two always match.
- **`total` finality**: `total` is written by `admit()` (pre-running errors) or `end()` (running
  tasks) only. Errors thrown while running no longer write `total` themselves, so a consumer
  that pulls after a listener-driven cleanup cannot mutate the published timing. `run()`'s
  observable timing is unchanged, because `end()` already overwrote `total` in `finally`.

## S6. Provider type

- **Decision**: Extend the local `Session` shape with
  `promptStreaming(input, { signal }): AsyncIterable<string>`. Chrome returns a `ReadableStream`,
  which is async-iterable in current Chrome. Chunks are passed through as-is (deltas).
- **Alternatives rejected**: Typing it as `ReadableStream` (couples the fake and the type to a
  class AkariSP never uses directly).

## S7. Single use

- **Decision**: A `used` flag checked at the start of the generator body. A second iteration
  throws `TypeError('stream already consumed')` on its first `next()` without admitting a task.
  This is a programming error, not a task outcome, so it is not a `TaskError` and does not set
  `stream.timing`.
