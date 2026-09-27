# Quickstart & Validation: Browser Compatibility Validation

## Automated

```bash
npm test               # 98 existing (unchanged) + test/report.test.ts
npx tsc --noEmit -p .
npm run build
```

## Automated browsers (Layer 2)

```bash
npm i -D @playwright/test                     # once
npx playwright install chromium firefox webkit # once, several hundred MB (engines, not models)
npm run test:browser                          # builds, serves, runs e2e/ on 3 engines
```

Expected: all pass on Chromium, Firefox, WebKit whatever capability each exposes. These results
are engine evidence only (WebKit ≠ Safari; no real-model lifecycle claim).

## Manual (per browser, Layer 3)

```bash
npm run build
python3 -m http.server 8080
```

Open `http://localhost:8080/smoke/streaming.html?browser=<Chrome|Edge|Firefox|Safari>`
(localhost = secure context; the label only fills `runner.browser`).

| Environment | Expected |
|---|---|
| API absent (e.g. a browser without the Prompt API) | Page renders; classification `API_ABSENT`; import PASS; 7 lifecycle checks SKIPPED; overall SKIPPED; no errors in console |
| API present, model downloadable / downloading / unavailable / unknown | Raw availability shown; lifecycle checks BLOCKED with reason; overall BLOCKED; no download starts (no `create()` call) |
| Model available | Click each check (or Run All): import + 7 checks PASS; overall PASS; clone isolation shows INFO |
| Served over plain http from a non-localhost host | `secureContext: false`; lifecycle checks BLOCKED |

Then **Copy JSON** and, for a browser actually tested, save it as
`smoke/results/<YYYY-MM-DD>-<os>-<browser><major>.json`.

Network tab: only `streaming.html`, `streaming.js`, `report.js`, and `dist/*.js` requests.

## Validation matrix (filled only by real runs)

| Layer | Target | Result |
|---|---|---|
| 1 | `npm test` (Node, fake provider) | NOT RUN |
| 2 | Playwright Chromium | NOT RUN |
| 2 | Playwright Firefox | NOT RUN |
| 2 | Playwright WebKit (engine, not Safari) | NOT RUN |
| 3 | Chrome desktop (real model) | NOT TESTED |
| 3 | Edge desktop | NOT TESTED |
| 3 | Firefox desktop | NOT TESTED |
| 3 | Safari desktop | NOT TESTED |
