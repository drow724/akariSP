# Contract: AkariSP v0.3 Public API (delta from v0.2)

v0.2 contract: `specs/002-streaming-execution/contracts/public-api.md`. Unchanged except below.

```ts
export interface Runtime {
  // ...v0.2 members unchanged: state, run, stream, shutdown
  /** Synchronous, read-only view of current state. Never waits, never changes anything. */
  snapshot(): RuntimeSnapshot;
}

export interface RuntimeSnapshot {
  state: Runtime['state'];
  /** Tasks holding a concurrency slot (clone → prompt → task session destroyed). */
  active: number;
  /** Tasks waiting for a slot. */
  queued: number;
  limit: number;
  queueCapacity: number;
}
```

## Behavior contract

| Situation | Result |
|---|---|
| Any state (`ready` / `broken` / `closed`) | Returns a snapshot; never throws |
| Idle | `{ state: 'ready', active: 0, queued: 0, limit, queueCapacity }` |
| Unused `stream()` | Counts unchanged |
| Task whose model work ended but session not yet destroyed | Still in `active` |
| Queued task granted a slot | Moves from `queued` to `active` atomically for any observer |
| Rejected or cancelled-while-queued task | Not in `queued` |
| Broken | `queued: 0`; `active` counts tasks still running on their own clones |
| Shutdown in progress | `state: 'closed'`, `queued: 0`, `active` ≥ 0 until cleanup ends |
| After `await shutdown()` | `{ state: 'closed', active: 0, queued: 0, … }` |
| Caller mutates the returned object | No effect on the runtime or later snapshots |

## Unchanged

`createRuntime`, `run`, `stream`, `shutdown`, `state`, `TaskError`, `TaskTiming`, `TaskStream`,
`TaskResult`, `RuntimeOptions`. No new options; no named `RuntimeState` export (research P3).
