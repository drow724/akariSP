# Contract: AkariSP v0.2 Public API (delta from v0.1)

v0.1 contract: `specs/001-warm-session-clone/contracts/public-api.md`. Unchanged except the
additions below.

```ts
export interface Runtime {
  // ...v0.1 members unchanged: state, run, shutdown
  /** Lazy: nothing is admitted until the first pull. Single-use. */
  stream(input: Prompt, options?: { signal?: AbortSignal }): TaskStream;
}

export interface TaskStream extends AsyncIterable<string> {
  /** undefined until the task has ended and its resources are cleaned up. */
  readonly timing: TaskTiming | undefined;
}
```

## Behavior contract

| Call / situation | Result |
|---|---|
| `runtime.stream()` | Returns immediately; no admission, queue entry, slot, clone, or provider call |
| First pull, runtime `broken` / `closed` | Throws `TaskError('broken' / 'closed')`; `timing` set |
| First pull, signal already aborted | Throws `TaskError('cancelled')`; no clone |
| First pull, limit + queue full | Throws `TaskError('rejected')` |
| First pull, limit reached, queue has room | Waits FIFO with `run()` tasks |
| Chunks | Yielded in provider order, unmodified |
| Model stream ends | Loop ends; session destroyed and slot released before it ends; `timing` complete incl. `prompt` |
| `timing.prompt` meaning | From the `promptStreaming()` call until the loop observes the model's end. Iteration is pull-based, so this includes the consumer's processing time between chunks |
| Model stream errors | Throws `TaskError('failed', cause)`; cleaned up first |
| `break` / `iterator.return()` | Provider stream cancelled, session destroyed, slot released, then the loop exit completes; no error; `timing.prompt` undefined |
| Caller abort / timeout | Throws `TaskError('cancelled', signal.reason)` (`TimeoutError` for timeouts); cleanup does not wait for the consumer to pull |
| Abort while clone pending, clone resolves later | Late session destroyed, never prompted, then `TaskError('cancelled')` |
| Clone `InvalidStateError` | `TaskError('broken')`; runtime `broken`; same as `run()` |
| `shutdown()` with active streams | Streams end with `TaskError('cancelled')` (`cause.name === 'AbortError'`); `shutdown()` resolves after all their sessions are destroyed, even if consumers are paused |
| Second iteration of the same stream | First `next()` throws `TypeError`; no admission |

## Unchanged

`createRuntime`, `run`, `shutdown`, `state`, `TaskError`, `TaskTiming`, `RuntimeOptions`.
No new options.
