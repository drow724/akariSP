# Quickstart & Validation: Second Provider Validation

## Automated

```bash
npm test               # core (Chrome-like + clone-less fakes), browser adapter, webllm adapter, boundary, report
npx tsc --noEmit -p .
npm run build
npm run test:browser   # 006 Playwright suite, unchanged
```

| Check | Where | Spec |
|---|---|---|
| Existing suites pass, assertions unchanged (harness adapted to the seam) | `test/runtime.test.ts` | FR-616 |
| Clone-less provider runs run/stream/cancel/shutdown | `test/runtime.test.ts` (new) | FR-601, US1 |
| Shutdown awaits async task cleanup → base cleanup → provider-wide close, in order | `test/runtime.test.ts` (new) | FR-605/606, US2 |
| Async rollback keeps the original creation error; no close on failed creation | `test/runtime.test.ts` (new) | 004 FR-309, FR-605 |
| Chrome predicate: DOMException InvalidStateError → broken; lookalike → failed | `test/browser.test.ts` | FR-607 |
| WebLLM adapter against a fake engine with v0.2.85 lock/interrupt behavior, incl. never-pulled and first-token-pending abort/timeout/shutdown (deferred gate), paused-consumer abort, unload once via close, no unload on failed creation | `test/webllm.test.ts` | FR-603, 607–611, 613, 614 |
| Core has no `clone` / `InvalidStateError` / browser / webllm reference | `test/boundary.test.ts` | SC-601 |

## Real browsers

```bash
npm run build && python3 -m http.server 8080
```

- Chrome with the Prompt API model: `http://localhost:8080/smoke/streaming.html?browser=Chrome`
  → import + 7 lifecycle PASS (FR-616).
- WebGPU browser, WebLLM model cached: `http://localhost:8080/smoke/webllm.html` → Load model
  (cached) → the 9 FR-615 checks PASS. Save the JSON under `smoke/results/`.
