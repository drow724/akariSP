# Compatibility harness (streaming + lifecycle)

`smoke/streaming.html` classifies the Prompt API capability the current browser actually
exposes, then runs AkariSP lifecycle checks where a model is available. It uses no fake model,
makes no performance claims, does not judge output content, and never starts a model download
(it only calls `LanguageModel.availability()`; `create()` runs only inside a check you start on
an available model).

## Run

```bash
npm run build
python3 -m http.server 8080
```

Open `http://localhost:8080/smoke/streaming.html?browser=<Chrome|Edge|Firefox|Safari>`
(`localhost` is a secure context). The `browser` label only fills `runner.browser` in the JSON.
Click a check, or **Run All**. Run All keeps going after a failure; a check refused during Run
All (for example for missing user activation) is BLOCKED and can be rerun from its own button.
Each check creates its own runtime and always shuts it down. A harness watchdog fails a check
after 120 s so the page never hangs; the watchdog is not AkariSP behavior. Details and stack
traces go to the DevTools console. **Copy JSON** copies the result; the JSON block is always
visible for manual copy. Nothing is sent anywhere.

URL parameters (declared by whoever opens the page, never inferred from the user agent):
`?browser=<label>` for manual runs; `?runner=playwright&engine=<chromium|firefox|webkit>` is
used by the automated suite.

## Three validation layers (none replaces another)

| Layer | Runner | Evidence of |
|---|---|---|
| 1 | `npm test` (Node, fake provider) | Runtime semantics, plus the harness outcome logic (`test/report.test.ts`) |
| 2 | `npm run test:browser` (Playwright Chromium, Firefox, WebKit engines) | Harness, import safety, classification, gating, JSON shape on 3 engines |
| 3 | This page opened manually in a real browser | Real Chrome / Edge: Prompt API lifecycle. Real Safari / Firefox: branded-browser capability |

Playwright WebKit is an engine, **not Safari**; Playwright results are never Safari, Chrome, or
Firefox product results, and automated engines never replace real-model lifecycle evidence.
Layer 2 needs the engines once: `npx playwright install chromium firefox webkit` (hundreds of
MB of browser binaries, not models; never run automatically).

## Classification

| Observation | Classification |
|---|---|
| No `LanguageModel` | `API_ABSENT` |
| No `availability()`, or it throws | `API_PRESENT_UNAVAILABLE` (error recorded) |
| `"unavailable"` | `API_PRESENT_UNAVAILABLE` |
| `"downloadable"` | `MODEL_DOWNLOADABLE` |
| `"downloading"` | `MODEL_DOWNLOADING` |
| `"available"` | `MODEL_AVAILABLE` |
| any other value | `UNKNOWN_AVAILABILITY` (raw value kept) |

## Outcomes

- **PASS**: the check ran and AkariSP's contract held.
- **FAIL**: the check ran and an assertion failed, the watchdog timed out, or an unexpected error.
- **BLOCKED**: applicable but the environment prevents it: API present but no available model,
  not a secure context, or a browser refusal (`NotAllowedError`, directly, as a `cause`, or
  observed during the check).
- **SKIPPED**: not applicable: the API is absent.
- **INFO**: diagnostic evidence only (for example the clone-isolation marker); never affects any
  outcome.

**Overall**: any FAIL → FAIL; else any BLOCKED → BLOCKED; else all 7 lifecycle checks SKIPPED →
SKIPPED (never PASS); else all 7 PASS → PASS; else INCOMPLETE (checks not run yet).

## Checks

Several checks use `limit: 1, queueCapacity: 0`. In that setup `run()` is rejected immediately
if a slot is still held, so an admitted `run()` is public proof that a slot was released.

| Check | Contract checked |
|---|---|
| Import AkariSP | The built package loads and exports `createRuntime` / `TaskError`; where the API is absent, the import reads `LanguageModel` 0 times |
| Normal run | `run()` returns a non-empty string and numeric `timing.total` / `prompt`; runtime stays `ready` and serves a second `run()`; `shutdown()` → `closed` |
| Normal streaming | Lazy: an un-iterated stream holds no slot (FR-103). ≥ 1 string chunk; normal completion; `timing` undefined while running, then defined with numeric `total` and `prompt` (FR-113); runtime stays `ready` |
| Early break | `break` after 1 chunk throws nothing (FR-107); a `run()` issued right after the loop exit is admitted, so cleanup had finished (FR-105); `timing.prompt` undefined |
| Caller abort | Abort after the first chunk ends with `TaskError('cancelled')` and `cause === signal.reason` (FR-108); runtime reusable afterwards. Logs the real abort reason name |
| Shutdown during streaming | Shutdown is started outside the consumer loop. It resolves; `stream.timing` is already published when it resolves (FR-111); the consumer ends `cancelled` with `cause.name === 'AbortError'`; state `closed`; new `run()` and `stream()` are rejected `closed` |
| Lazy stream | An unused stream does not delay `shutdown()`; its first pull afterwards is rejected `closed` (FR-103) |
| Clone isolation | Three tasks from the same warm base complete; runtime stays `ready`; `shutdown()` → `closed`. INFO only: whether task B's output contains the random marker given to task A (isolation itself is proven by the unit tests) |

Chunk order is whatever the browser delivers; AkariSP passes chunks through unchanged, so the
page checks only that chunks are strings. Order is verified by the unit tests.

## Evidence files

Both files recorded on 2026-09-27 have `runner.browser: null` because the page was opened
without `?browser=`; the browser is identified by the recorded `userAgent` (diagnostic label
only). Files are stored exactly as copied.

Save the copied JSON as `smoke/results/<YYYY-MM-DD>-<os>-<browser><major>.json`, only for runs
actually performed. These are dated evidence of what was observed, not a support table; nothing
reads them.

## Validation matrix

| Layer | Target | Result |
|---|---|---|
| 1 | Node (`npm test`) | 105/105 PASS (2026-09-27) |
| 2 | Playwright Chromium 153 (engine) | PASS; native: API present, `downloadable` → lifecycle BLOCKED |
| 2 | Playwright Firefox 155 (engine) | PASS; native: `API_ABSENT` → lifecycle SKIPPED |
| 2 | Playwright WebKit 26.6 (engine, not Safari) | PASS; native: `API_ABSENT` → lifecycle SKIPPED |
| 3 | Chrome 152 desktop (macOS 15.7; version from the recorded user agent) | 2026-09-27: import + 7 lifecycle PASS (real model), overall PASS; clone-isolation INFO: marker not observed in task B — [evidence](results/2026-09-27-macos-chrome152.json); re-run after 007 core change: 7/7 PASS — [evidence](results/2026-09-27-macos-chrome152-007.json); re-run after 008 packaging: 7/7 PASS — [evidence](results/2026-09-27-macos-chrome152-008.json) |
| 3 | Edge desktop | NOT TESTED (not installed) |
| 3 | Firefox desktop | NOT TESTED (not installed) |
| 3 | Chrome 152 desktop + WebLLM 0.2.85 | 2026-09-27 (007 internal module): 9/9 PASS — [evidence](results/2026-09-27-macos-chrome152-webllm.json); final code after review: 9/9 PASS — [evidence](results/2026-09-27-macos-chrome152-webllm-final.json); 008 public entry `dist/webllm.js`: 9/9 PASS — [evidence](results/2026-09-27-macos-chrome152-webllm-008.json) |
| 3 | Safari 26.3 desktop (macOS 15.7) | 2026-09-27: import PASS, `API_ABSENT`, 7 lifecycle SKIPPED, overall SKIPPED — [evidence](results/2026-09-27-macos-safari26.json) |

Mobile browsers are out of scope.

## WebLLM validation

`smoke/webllm.html` validates AkariSP's WebLLM integration through `dist/webllm.js`, the file
the public `akarisp/webllm` export points to (008; the 007 runs used the internal module) on a
real engine: WebLLM 0.2.85 from `esm.run`, model `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`, WebGPU browser.
Click **Load model** once (download, then browser cache), then each check or **Run All**.

Engine ownership: each check creates an engine from the cache and hands it to a runtime, which
uses it exclusively and unloads it at shutdown. That is why every check loads its own engine.

| Check | Verifies (spec 007 FR-615) |
|---|---|
| isolation | A marker given to task A is absent from task B's output |
| cloneless | `run` and `stream` work with no clone anywhere |
| serialization | `limit: 2` → TypeError; with `limit` 1 the second task waits in AkariSP's queue (`active 1, queued 1`) and starts after the first ends |
| queuedCancel | Aborting a queued task cancels only it; the running task completes |
| activeCancel | Abort mid-stream and a 300 ms timeout both end `cancelled`; the next run is normal |
| earlyBreak | `break` after 2 chunks; the next run completes |
| shutdownUnload | Shutdown during a stream resolves after unload finished (`getMessage` → `ModelNotLoadedError`); stream ends `cancelled` |
| classification | An invalid setting fails only its task; an unloaded engine makes the runtime `broken` |
| templates | Alternating APPLE / BANANA templates each answer with their own word |

Research evidence behind these checks: `experiments/webllm/EVIDENCE.md`.

## Actual Safari automation (not in 006)

Not implemented. Recipe for later: a macOS runner → `sudo safaridriver --enable` → start a W3C
WebDriver session with `safaridriver` → open the page with `?runner=ci-safari` → wait for
`body[data-ready="true"]` → read `#json`. Playwright cannot drive real Safari, and today Safari
exposes no Prompt API, so this would only re-verify the `API_ABSENT` path.
