# Quickstart & Validation: Streaming Task Execution

API: [contracts/public-api.md](contracts/public-api.md). Lifecycle table:
[data-model.md](data-model.md).

## Usage

```js
const stream = runtime.stream('Explain HTTP in two sentences.', { signal: AbortSignal.timeout(10_000) });
for await (const chunk of stream) {
  output.textContent += chunk;
  if (userClickedStop) break; // session destroyed and slot released before the loop exits
}
console.log(stream.timing); // final TaskTiming, or undefined if never iterated
```

## Validation

```bash
npm test
```

All 001 tests pass unchanged (SC-105), plus these streaming tests, run against a fake
`promptStreaming` that yields controllable chunks, honors its signal, and records whether it
was cancelled:

| Scenario | Spec |
|---|---|
| Chunks arrive in order; loop ends; session destroyed; `timing` complete incl. `prompt` | US1, FR-101/106/113 |
| Two streams use distinct clones; base never prompted | US1, FR-102 |
| `stream()` without iteration: 0 clones, queue unaffected, `timing` undefined | FR-103 |
| Iteration begins after shutdown / broken → `closed` / `broken` | FR-103, edge cases |
| `break` after first chunk: provider stream cancelled, session destroyed, waiter starts, no error, `prompt` undefined; `live` back to 1 before the loop exit completes | US2, FR-107, SC-103 |
| `timing` is `undefined` while chunks are flowing | FR-113 |
| Caller abort mid-stream; `AbortSignal.timeout` mid-stream (`TimeoutError`) | US3, FR-108 |
| Model error mid-stream → `failed`; chunks before it delivered | US3 |
| Abort while consumer paused (not pulling): `live` back to 1 without a pull; next pull throws `cancelled` | FR-109 |
| Late clone after abort: destroyed, `promptStreaming` never called | FR-110 |
| Shutdown with a paused active stream resolves; stream throws `cancelled` (`AbortError`) on next pull | FR-111 |
| Mixed queue: limit 1, queue 1 — stream, run, stream → run waits, second stream rejected, run starts only after first stream's session destroyed | US4, FR-104/105 |
| Queued stream aborted → `cancelled`, no clone | US4 |
| Clone `InvalidStateError` on stream → `broken`; an active stream on its own clone continues | FR-108, 001 FR-011a |
| Second iteration → `TypeError`, no clone | FR-112 |
| 100 mixed streams (complete, break, abort, timeout, error) then shutdown → `live === 0` | SC-102 |
| Burst of mixed run/stream beyond capacity → running ≤ limit, all settle | SC-104 |

## Manual real-Chrome smoke check

The unit tests use a fake provider. To check compatibility with Chrome's real `LanguageModel`
(`promptStreaming` iteration, provider cancellation on `break`, abort and shutdown cleanup), run
the smoke page described in [`smoke/README.md`](../../smoke/README.md):

```bash
npm run build && python3 -m http.server 8080
```

Open `http://localhost:8080/smoke/streaming.html` in Chrome with the model already downloaded and
press **Run All**. Expected: 5/5 PASS (normal streaming, early break, caller abort, shutdown during
streaming, lazy stream). The page never starts a model download.

No benchmark change: this feature makes no new performance claim (Constitution III).
