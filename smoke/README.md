# Streaming smoke test (manual, real Chrome)

Checks that the real Chrome `LanguageModel` works with AkariSP's streaming lifecycle:
`promptStreaming()` → `runtime.stream()` → `for await` → `break` / abort / shutdown →
deterministic cleanup. It uses no fake model, makes no performance claims, and does not judge
output content.

## Run

Prerequisites: desktop Chrome with the Prompt API and the on-device model **already
downloaded** (`await LanguageModel.availability()` returns `"available"`). The page never
starts a download; if the model is missing it shows:

```
LanguageModel exists, but model is not currently available.
Install/download the browser model before running smoke tests.
```

```bash
npm run build
python3 -m http.server 8080
```

Open `http://localhost:8080/smoke/streaming.html`. Click a test button, or **Run All**. Run All
keeps going after a failure. Each test creates its own runtime and always shuts it down.
A harness watchdog fails a test after 120 s so the page never hangs; the watchdog is not
AkariSP behavior. Details and stack traces go to the DevTools console.

## Tests

Several tests use `limit: 1, queueCapacity: 0`. In that setup `run()` is rejected immediately
if a slot is still held, so an admitted `run()` is public proof that a slot was released.

| Test | Contract checked |
|---|---|
| Normal streaming | Lazy: an un-iterated stream holds no slot (FR-103). ≥ 1 string chunk; normal completion; `timing` undefined while running, then defined with numeric `total` and `prompt` (FR-113); runtime stays `ready` |
| Early break | `break` after 1 chunk throws nothing (FR-107); a `run()` issued right after the loop exit is admitted, so cleanup had finished (FR-105); `timing.prompt` undefined |
| Caller abort | Abort after the first chunk ends with `TaskError('cancelled')` and `cause === signal.reason` (FR-108); runtime reusable afterwards. Logs the real abort reason name |
| Shutdown during streaming | Shutdown is started outside the consumer loop. It resolves; `stream.timing` is already published when it resolves (FR-111); the consumer ends `cancelled` with `cause.name === 'AbortError'`; state `closed`; new `run()` and `stream()` are rejected `closed` |
| Lazy stream | An unused stream does not delay `shutdown()`; its first pull afterwards is rejected `closed` (FR-103) |

Chunk order is whatever Chrome delivers; AkariSP passes chunks through unchanged, so the page
checks only that chunks are strings. Order is verified by the unit tests.
