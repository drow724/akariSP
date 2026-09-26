# Quickstart & Validation: Core / Browser Provider Boundary

Contract: [contracts/public-api.md](contracts/public-api.md). No user-visible change: 001–004
usage code runs as is.

## Automated

```bash
npm test
npx tsc --noEmit -p .
npm run build
```

| Check | Where | Spec |
|---|---|---|
| 89 existing 001–004 tests pass, assertions unchanged, running against `createCoreRuntime` with a fake provider | `test/runtime.test.ts` | SC-403, FR-412 |
| `src/core/` (comments stripped) has no `LanguageModel` / `window` / `globalThis` / `navigator` / `self` / `document` token and no static or dynamic import of the browser area | `test/boundary.test.ts` | SC-401, FR-404 |
| Importing core with a trapping `globalThis.LanguageModel` getter: succeeds, 0 reads | `test/boundary.test.ts` | SC-402 |
| Public value exports are exactly `createRuntime`, `TaskError` | `test/boundary.test.ts` | SC-407 |
| Browser-owned only: import without global (0 reads); global read only on base create (`{ limit: 0 }` → `TypeError`, 0 reads; absent → `ReferenceError`); native `create` gets the same config objects; `run` via public `createRuntime` uses the native session as returned | `test/browser.test.ts` | SC-404, US3 |
| Clone / prompt / promptStreaming / signal propagation / destroy / cancellation / streaming / templates / broken / shutdown | `test/runtime.test.ts` (core) | FR-412 |
| Public names exactly the 8 004 names; public type shapes identical to the 004 baseline (compile-time fixture); `package.json` unchanged; 0 `dependencies` | final verification | SC-407 |
| `git diff $BASE -M -B -- src/`: only provider injection + comment edits in the moved policy | final verification | FR-407 |
| Clone error `{ name: 'InvalidStateError' }` (not a `DOMException`) → `'failed'`, runtime stays `ready` | `test/runtime.test.ts` (core) | FR-407 |

## Manual (real Chrome)

```bash
npm run build
python3 -m http.server 8080
```

Open `http://localhost:8080/smoke/streaming.html` → **Run All** → expect 5/5 PASS (SC-405).
The harness imports `../dist/index.js` unchanged, so it now exercises browser → core. The model
must already be downloaded; the page never starts a download. Optionally open
`bench/index.html` to confirm it still loads and runs (no new performance claim).
