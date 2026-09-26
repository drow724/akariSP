# Data Model: Runtime Snapshot

No new runtime state. `RuntimeSnapshot` is a value computed on demand from existing state
(research P1).

## RuntimeSnapshot

| Field | Type | Source | Notes |
|---|---|---|---|
| state | `Runtime['state']` (`'ready' \| 'broken' \| 'closed'`) | `state` | Same value as `runtime.state` |
| active | number | `running` | Tasks holding a slot: from slot grant (before clone) until `release()` after the task session is destroyed |
| queued | number | `queue.length` | Tasks waiting for a slot; `run()` and streams after their first pull |
| limit | number | `limit` | Effective value, default 1 |
| queueCapacity | number | `queueCapacity` | Effective value, default 32 |

Invariants that follow from the existing scheduler (not enforced by new code):
`0 ≤ active ≤ limit`, `0 ≤ queued ≤ queueCapacity`, `queued === 0` whenever
`state !== 'ready'`, and `active === 0 && queued === 0` once `shutdown()` has resolved.

## When each count changes (existing transitions)

| Event | active | queued |
|---|---|---|
| `stream()` created, not pulled | – | – |
| Admission with a free slot (`run` call / first stream pull) | +1 | – |
| Admission when the limit is reached and the queue has room | – | +1 |
| Admission when the queue is full (rejected) | – | – |
| Waiting task aborted | – | −1 |
| Slot released, waiter handed the slot (one synchronous step) | ±0 (−1 +1) | −1 |
| Slot released, no waiter or state not ready | −1 | – |
| Broken transition (`drain('broken')`) | – (running tasks continue) | → 0 |
| `shutdown()` starts (`drain('closed')`, abort running) | – until each cleanup releases | → 0 |
| Task session destroyed → `release()` | −1 | – |
