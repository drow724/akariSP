# Quickstart & Validation: Runtime Snapshot

API: [contracts/public-api.md](contracts/public-api.md). Count transitions:
[data-model.md](data-model.md).

## Usage

```js
const { state, active, queued, limit, queueCapacity } = runtime.snapshot();
statusEl.textContent = `${state}: ${active}/${limit} running, ${queued}/${queueCapacity} waiting`;
```

## Validation

```bash
npm test
```

All 001 and 002 tests pass unchanged (SC-205), plus these snapshot tests against the existing
fake `LanguageModel`:

| Lifecycle point | Expected snapshot | Spec |
|---|---|---|
| Idle, defaults | `ready`, 0, 0, limit 1, queueCapacity 32 | US1/AC1, FR-206 |
| Active `run` (held prompt) | active 1 | FR-204 |
| Active `stream` (held after first chunk) | active 1 | FR-204 |
| `limit: 2`, 2 held + 5 queued (mixed run/stream) | active 2, queued 5 | US1/AC2–3 |
| Lazy stream created, not pulled | counts unchanged | US2/AC1 |
| Stream's first pull waits behind the limit | queued +1 | US2/AC2 |
| Queue-full rejection | queued unchanged | US2/AC3 |
| Queued task aborted | queued −1 | US2/AC4 |
| Cleanup in progress (snapshot taken inside the fake's `destroy`) | active still includes the task | US2/AC5 |
| Slot handoff (snapshot inside `destroy` of task A and after B starts) | never both / never neither; totals conserved | US2/AC6 |
| Broken with an active task | `broken`, queued 0, active 1 | US3/AC1 |
| Shutdown in progress (right after calling `shutdown()` with a held task) | `closed`, queued 0, active 1 | Edge case |
| Shutdown completed | `closed`, 0, 0 | FR-209 |
| Paused stream consumer after abort | active drops without another pull | Edge case |
| Mutating a returned snapshot | next snapshot unaffected; runtime unaffected | FR-208 |
| Burst of 100 mixed tasks, snapshot on every settle | active ≤ limit, queued ≤ queueCapacity; 0/0 at the end | SC-203 |
| 10,000 snapshot calls | fake `creates`/`clones`/`destroys` unchanged; later `run()` behaves normally | SC-204, FR-202 |

No benchmark change: no performance claim (Constitution III).
