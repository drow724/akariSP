# Contract: AkariSP v0.1 Public API

The entire public surface. Anything not listed here is internal (Principle XII).

```ts
export function createRuntime(options?: RuntimeOptions): Promise<Runtime>;

export interface RuntimeOptions {
  /** Passed unchanged to LanguageModel.create(): initialPrompts, temperature, topK,
   *  expectedInputs, signal, monitor, etc. Used once for the base session. */
  session?: LanguageModelCreateOptions;
  /** Absolute cap on running tasks (slot acquire → clone → prompt → destroy → release).
   *  Integer ≥ 1. Default 1. */
  limit?: number;
  /** Max waiting tasks. Finite integer ≥ 0. Default 32.
   *  When limit is reached and the queue is full, run() rejects (v0.1 has no other policy). */
  queueCapacity?: number;
}

export interface Runtime {
  readonly state: 'ready' | 'broken' | 'closed';
  /** Clone base → prompt → destroy clone. */
  run(input: LanguageModelPrompt, options?: { signal?: AbortSignal }): Promise<TaskResult>;
  /** Reject waiters, cancel running tasks, destroy all sessions. Idempotent and safe to
   *  call concurrently; never rejects. Resolves only after all cleanup is done. */
  shutdown(): Promise<void>;
}

export interface TaskResult {
  output: string;
  timing: TaskTiming; // all four fields present
}

export interface TaskTiming {
  // A field is set only if its phase completed; total is always set.
  queueWait?: number; // ms
  acquire?: number;   // ms, clone duration
  prompt?: number;    // ms
  total: number;      // ms, submit → outcome
}

export class TaskError extends Error {
  readonly code: 'failed' | 'cancelled' | 'rejected' | 'closed' | 'broken';
  readonly cause: unknown;
  readonly timing: TaskTiming; // partial
}
```

`LanguageModelCreateOptions` and `LanguageModelPrompt` are the provider's own types, not
redefined by AkariSP beyond what the build needs.

## Behavior contract

| Call / situation | Result |
|---|---|
| `createRuntime()` with invalid policy | rejects `TypeError`; no session created |
| `createRuntime()` when `LanguageModel.create` rejects | rejects with that error unchanged |
| `run()` success | resolves `{ output, timing }`; clone destroyed |
| `run()` with already-aborted signal | rejects `TaskError('cancelled')`; no clone |
| signal aborts while waiting / cloning / prompting | rejects `TaskError('cancelled', cause = signal.reason)`; clone (if any) destroyed; waiter listener removed |
| `AbortSignal.timeout(ms)` fires | same as abort; `cause.name === 'TimeoutError'`; timing holds only completed phases |
| abort while `clone()` pending, clone resolves later | late clone destroyed, slot released, then rejects `'cancelled'`; `timing.acquire` set; `prompt()` never called |
| any outcome | the promise settles only after the task's session is destroyed and its slot released |
| `prompt()` rejects | rejects `TaskError('failed', cause = original)`; clone destroyed |
| `clone()` rejects `InvalidStateError` | rejects `TaskError('broken')`; `state → 'broken'` (base no longer trusted); waiters rejected `'broken'`; tasks already holding a clone continue |
| `clone()` rejects otherwise | rejects `TaskError('failed')`; state unchanged |
| limit + queue full | rejects `TaskError('rejected')` immediately; no clone |
| `run()` in `broken` / `closed` | rejects `TaskError('broken' / 'closed')` |
| `shutdown()` | waiters → `'closed'`; running → `'cancelled'` with `cause.name === 'AbortError'` (message text not contractual); resolves after every clone and the base are destroyed |
| `shutdown()` again, while in progress, or concurrently | returns the same promise; no error; no repeated cleanup |
| `shutdown()` on `broken` | same as from `ready` |

## Non-contract (explicitly not exposed)

Queue contents, slot counts, the runtime abort controller, the base session object, and any
aggregate metrics.
