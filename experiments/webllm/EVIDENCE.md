# WebLLM evidence for the 007 provider contract

Common to every row:

| Field | Value |
|---|---|
| WebLLM version | `@mlc-ai/web-llm` 0.2.85 (npm, loaded from `esm.run`) |
| Source revision read | tag `v0.2.85` (what npm ships); predictions were first made from `main` `bd46399` |
| Model | `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` |
| Browser / version | Chrome 152, macOS (`userAgent` in `results/*.json`) |
| WebGPU | present |

Verdict: **confirmed** = observed as predicted; **refuted** = the prediction was wrong;
**inconclusive** = the harness did not produce a usable result.

| Exp | Expected (source-based prediction) | Observed (`results/`) | Verdict | Contract implication |
|---|---|---|---|---|
| E1 isolation | Requests rebuild context from `messages`; no leak | B and C answered `NONE`; marker absent (run1) | confirmed | Per-task isolation needs no cloned session object |
| E2 clone necessity | Core blocks at `base.clone()` | `TaskError('failed')`, cause `TypeError`; missing `destroy` swallowed (run1) | confirmed | `clone` removed from the core contract; `start(base)` instead |
| E3 concurrency | Per-model FIFO lock serializes generations | B's first chunk 60 ms after A ended (run1) | confirmed | WebLLM runs with `limit` 1; waiting stays in AkariSP's queue |
| E4 queued cancel | No request-local cancel; engine-wide interrupt hits the running request | Interrupt aborted A (`abort`), B ran (`stop`); B's iterator `return()` still let B generate (run1) | confirmed | Never hand the engine a waiting request |
| E5 active cancel | Interrupt flag persists into the next non-streaming request | B, D, E (non-streaming) returned `""`; streaming C, F normal; G normal after F (run2). run1 stalled after e4b (explained by E6) | confirmed | Adapter always uses the streaming path |
| E6 early break | (from `main`) `finally` releases the lock, next request starts | Next `create()` never returned; heartbeat kept running (e6 rerun log). v0.2.85 releases the lock only at the generator's end | **refuted** | Early termination needs a provider-specific cleanup protocol; never `return()` the native iterator |
| E6b interrupt + drain | Draining to the natural end releases the lock | Next request first chunk 42 ms after A ended, completed (run3) | confirmed | `destroy()` = interrupt + drain (first `next()` if never pulled) |
| E7 async unload | `unload()` must be awaited | 68 ms awaited; later request `ModelNotLoadedError` (run1) | confirmed | Provider-wide cleanup is async and awaited (`close()`) |
| E7b unload during generation | Unload does not wait for generation | Active stream failed "Object has already been disposed" (run1) | confirmed | Shutdown: task cleanup completes before `close()` |
| E8 failure classes | Plain named `Error`s, no `DOMException`; interrupt is not an error | `ModelNotLoadedError`, `ModelNotFoundError`, `NonNegativeError`; interrupt `finish: "abort"`, no throw (run1) | confirmed | `broken` is provider-specific; adapter throws `signal.reason` on interrupt |
| E9 templates | Template = request messages; no per-template warm resource | Per-template outputs consistent; TTFT ≈ 0.06 s either way (run2; run1 invalid, polluted by E5) | confirmed | One engine for all templates; base = config; no `destroy(base)` |

Harness notes: e5 and e6 in run1, and e6 in run2, hit the 120 s watchdog. All three are explained
by E6 (a leaked lock), and the runs were repeated on fresh pages with step logs and heartbeat.
