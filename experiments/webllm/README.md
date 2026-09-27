# WebLLM provider experiments (pre-007)

Evidence for the 007 provider contract: how WebLLM (`@mlc-ai/web-llm` 0.2.85, loaded from
`esm.run`) behaves against AkariSP's current core assumptions (`clone()`, synchronous
`destroy()`, `InvalidStateError` → broken, per-task cancellation). Observations only; not an
AkariSP feature, not a benchmark, no dependency added.

## Run

```bash
npm run build
python3 -m http.server 8080
```

Open `http://localhost:8080/experiments/webllm/index.html` in a WebGPU browser (desktop Chrome).
Click **Load model** once: it downloads `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` (hundreds of MB,
cached by the browser). Then run experiments one by one. `e7_*` unload the engine; click
**Load model** again afterwards (cached, no re-download). **Copy JSON** and save as
`results/<YYYY-MM-DD>-<os>-<browser><major>.json`.

## Experiments

| Key | Question | Recorded |
|---|---|---|
| e1_isolation | One engine, independent requests A/B/C: does A's marker leak into B/C? | outputs, `markerInB`, `markerInC` |
| e2_clone_necessity | Pure request provider (no synthetic `clone`/`destroy`) wired into the core: where does it break? | createRuntime / run / stream / shutdown outcomes and error names |
| e3_concurrency | Two long streams submitted together: serialized by WebLLM's per-model lock? | submitted / first / end times of A and B |
| e4_queued_cancel | A runs, B waits on the lock, cancel only B. (a) engine-wide `interruptGenerate()`; (b) B's iterator `return()` | A's completion vs B's execution, timings |
| e5_active_cancel | Interrupt A mid-stream, then non-streaming B, streaming C, idle interrupt + D, E | output lengths / finish reasons (poisoned-flag check, issue #447) |
| e6_early_break | `break` a stream after 2 chunks, then start B | B's wait from A's end, B completes |
| e6b_interrupt_drain | Workaround for the 0.2.85 lock leak: interrupt A, consume to its natural end, then start B | A's finish, B's wait and completion |
| e7_unload | interrupt → A ends → `await unload()`; request afterwards | unload duration, post-unload error |
| e7b_unload_during_generation | `unload()` while A is generating (no interrupt) | unload outcome, how A's stream ends |
| e8_errors | not-loaded engine, unknown model id, invalid config, interrupt, after unload | error name / constructor / `instanceof DOMException` |
| e9_templates | Alternate two system prompts on one model | outputs, time-to-first-token, prefill rate |

Source reading behind the predictions: `src/engine.ts` and `src/support.ts` at `bd46399`
(per-model `CustomLock`, a single engine-wide interrupt flag, async `unload()`, plain `Error`
subclasses).

## Run notes

- `results/2026-09-27-macos-chrome152-run1.json` (stored as copied): e5 and e6 hit the 120 s
  harness watchdog. e6 ran on a second engine loaded in the same page while e5's engine was still
  stalled, so e6 is inconclusive. e9 is invalid as a template measurement: it ran after e8's
  interrupted stream, and all five non-streaming requests returned `""` in 0–1 ms with stale
  usage, i.e. the engine-wide interrupt flag leaked into later non-streaming requests
  (issue #447 behavior, reproduced on 0.2.85). The harness now clears that flag with a 1-token
  streaming request before each experiment, logs e5/e6 steps, and refuses to load a model again
  on a page where an experiment stalled.
- `results/2026-09-27-macos-chrome152-run2.json` (e5 and e9 on a freshly reloaded page, stored as
  copied): e5 completed. A non-streaming request after an interrupted stream returned `""`
  (`finish: "abort"`). An idle `interruptGenerate()` made the next two non-streaming requests
  return `""`. One streaming request cleared the flag. e9 alternated the two system prompts with
  consistent per-template output and equal time-to-first-token (about 0.06 s) whether or not the
  template changed. e6 logged `A loop exited; B stream` and produced no result and no watchdog
  record; see the e6 rerun.
- e6 rerun (fresh page, log only; no JSON because the experiment never settled): after `A loop
  exited; B stream`, `B: iterator created` never appeared while the 10 s heartbeat kept running
  past 120 s. Root cause in the **v0.2.85** source (not `main`): `chatCompletion()` acquires the
  per-model lock before returning a streaming iterator (lines 827–829), and `asyncGenerate`
  releases it only on caught errors or after its last statement (lines 530–768), not in a
  `finally`. An early `break`/`return()` therefore leaks the lock and every later `create()` waits
  forever. This also explains run1's e5 stall after e4b's `return()`. `main` (`bd46399`) moves
  the lock into the generator and releases it in `finally`, but that fix is not on npm yet.
- `results/2026-09-27-macos-chrome152-run3.json` (e6b, fresh page; taken from the log line
  because only the log was copied): interrupting A and consuming it to its natural end released
  the lock. B was created immediately, got its first chunk 42 ms after A ended, and completed
  (`stop`). On 0.2.85, interrupt + drain is a working alternative to `break`/`return()`.
