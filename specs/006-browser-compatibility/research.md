# Research: Browser Compatibility Validation

Builds on 005 (B1–B9). Decisions follow the spec Clarifications (Q1 C, Q2 C, Q3 A, three-layer test strategy).

## C1. Where the harness lives

- **Decision**: extend `smoke/streaming.html` + `smoke/streaming.js` in place (no rename), plus
  one tiny pure module `smoke/report.js` for classification and outcome math.
- **Rationale**: Q2 C. The five existing check functions keep their bodies byte-identical; only
  the harness around them (gating, outcome recording, JSON) changes. The pure logic is split out
  only so the automated suite can test it (C8); the page would otherwise be the single file.
- **Alternatives rejected**: new `compatibility.*` page (duplicates 5 checks); a test framework.

## C2. Import check and import safety

- **Decision**: replace the static `import … from '../dist/index.js'` with a dynamic import in
  `main()`, assigning module-level `let createRuntime, TaskError` so the existing check bodies
  are unchanged. The import check:
  - PASS when the import resolves and exports `createRuntime` and `TaskError` as functions;
  - when the API is absent, a counting getter is installed on `globalThis.LanguageModel` for the
    duration of the import and removed afterwards; any read → FAIL ("import touched the model
    API"). When the API is present the real global is not wrapped.
  - FAIL on any import error, with the error diagnostics.
- **Rationale**: a static import failure would kill the script before anything is reported; the
  dynamic import lets the page render and report it (US4). The absent-API trap mirrors the 005
  automated test in a real browser without touching a real API.

## C3. Capability classification

```text
secure  = globalThis.isSecureContext === true
present = 'LanguageModel' in globalThis            (same test as today)
present == false                           → API_ABSENT
typeof LanguageModel.availability != 'function' → API_PRESENT_UNAVAILABLE (reason: no availability())
raw = await LanguageModel.availability()   (no options, as today; never create())
  throws/rejects                           → API_PRESENT_UNAVAILABLE (error recorded)
  'unavailable'                            → API_PRESENT_UNAVAILABLE
  'downloadable'                           → MODEL_DOWNLOADABLE
  'downloading'                            → MODEL_DOWNLOADING
  'available'                              → MODEL_AVAILABLE
  anything else                            → UNKNOWN_AVAILABILITY (raw kept)
```

- The raw value is always kept. `navigator.userAgent` is read only for display and the JSON.
- **Runner** is declared by whoever opens the page, via URL parameters, never inferred:
  `?runner=playwright&engine=<chromium|firefox|webkit>` (set by the automated suite),
  `?browser=<label>` for manual runs (default `{ kind: "manual", browser: null }`). The page only
  copies these into the JSON; no decision reads them.
- A "Re-check availability" button reruns this (no reload), so a finished manual download is
  picked up; recorded results stay.

## C4. Gating (before any model-dependent check)

```text
classification == API_ABSENT        → SKIPPED  "LanguageModel API absent"
!secure                             → BLOCKED  "not a secure context"
classification != MODEL_AVAILABLE   → BLOCKED  "availability: <raw or error>"
import check != PASS                → not run  (overall is already FAIL)
otherwise                           → execute
```

Gated outcomes are recorded on page load for every model check (no click needed), so an
unsupported browser gets a complete result without executing anything. Executable checks stay
"not run" until clicked.

## C5. Outcome of an executed check

- First: if the thrown error, its `cause`, or any error observed during the check
  (`ctx.errors`, filled by the `consume()` and `describe()` helpers) or its `cause` is named
  `NotAllowedError` → **BLOCKED** ("native refusal: NotAllowedError"). So a refusal that an
  existing check body turned into an assertion failure is still BLOCKED. Only one `cause` level
  is checked. This covers permission-policy and user-activation refusals in current
  implementations; the name list is this one entry and grows only on evidence.
- Otherwise assertions (the existing `SmokeFailure`) → **FAIL**.
- Harness watchdog timeout → **FAIL** ("timed out"), as today.
- Any other unexpected error → **FAIL** with diagnostics.
- Cleanup shutdown failure → FAIL (unchanged).
- Message strings never decide an outcome.

## C6. Overall

Computed over the recorded outcomes; INFO is never read.

```text
any FAIL (import or lifecycle)         → FAIL
else any BLOCKED                       → BLOCKED
else all 7 lifecycle checks SKIPPED    → SKIPPED   (API absent: never shown as PASS)
else all 7 lifecycle checks PASS       → PASS
else                                   → INCOMPLETE (some executable checks not run yet)
```

`INCOMPLETE` is an overall-only value for a partially run page; it is never a check outcome.
The capability classification is reported separately from `overall`.

## C7. New checks

- **Normal run** (`limit: 1, queueCapacity: 0`): `run(SHORT_PROMPT)` → `output` is a non-empty
  string; `timing.total` and `timing.prompt` are numbers; state `ready`; a second `run()` is
  admitted and succeeds (reusable); `await rt.shutdown()` resolves and state is `closed`.
- **Clone isolation** (default `limit: 1`): marker = 8 random hex chars
  (`crypto.getRandomValues`). A: `run("Remember the code word <marker>. Reply with OK.")`;
  B: `run("If you were told a code word earlier in this conversation, repeat it. Otherwise reply NONE.")`;
  C: `run(SHORT_PROMPT)` on the same runtime (same warm base). PASS/FAIL: A, B, C each resolve with
  a string, state `ready` after C, shutdown resolves and state `closed`. INFO:
  `{ marker, markerObservedInOtherTask: B.output.includes(marker) }`, recorded only.

## C8. Automated check of the pure logic

- **Decision**: `smoke/report.js` exports `classify(present, hasAvailability, raw, error)`,
  `gate(capability, secure)`, `outcomeOf(error)` (BLOCKED vs FAIL for executed-check errors), and
  `overall(tests)`. `test/report.test.ts` covers the mapping table (including an unknown value),
  gating, the NotAllowedError rule, overall precedence, SKIPPED-only ≠ PASS, and that adding an
  `info` field never changes `overall`.
- **Rationale**: the branchy logic gets one runnable check (ponytail minimum) without a browser;
  the 98 existing tests are untouched (total becomes 98 + the new file's tests). This is the
  only place that proves "INFO never changes overall"; the Playwright layer checks the page
  wiring end to end.

## C9. Result JSON and evidence files

- Shape in [contracts/result-json.md](contracts/result-json.md). Built from the in-page state;
  rendered in a `<pre>` on every change; "Copy JSON" uses `navigator.clipboard.writeText` from the
  click (falls back to the rendered block if the clipboard is refused).
- Evidence: the maintainer saves the copied JSON as
  `smoke/results/<YYYY-MM-DD>-<os>-<browser><major>.json` (same style as `bench/results/`). The
  name is for humans only; nothing parses it. Nothing in `src/` or `smoke/` reads these files.

## C10. Production gate

`src/` changes only if a real-browser run reproduces an AkariSP production defect (a lifecycle
assertion fails for a reason that is AkariSP's, not the environment's). Different chunk sizes,
native messages, latency, or error names in another browser are recorded as evidence, never
normalized. The `InvalidStateError` rule is unchanged; different real behavior is recorded only.
If a defect is found, implementation stops and the fix is raised as a separate decision.

## C11. Automated cross-engine layer (Playwright)

- **Decision**: add `@playwright/test` (latest 1.63.x at planning time) as the only new dev
  dependency.
  - `playwright.config.ts` has projects `chromium`, `firefox`, and `webkit`.
  - `testDir: 'e2e'`, so it is separate from `test/*.test.ts` and `npm test` is unchanged.
  - `webServer` runs `npm run build && python3 -m http.server 8080` and reuses an existing server.
  - New script `test:browser` runs `playwright test`.
  - The engine binaries are downloaded once with `npx playwright install chromium firefox webkit`
    (several hundred MB). This is dev setup, not a model download, and the maintainer confirms it
    before it runs.
- **One shared spec file** `e2e/compatibility.spec.ts`. It opens
  `/smoke/streaming.html?runner=playwright&engine=${browserName}`, waits for the rendered JSON,
  and asserts:
  1. **Native capability** (no injection):
     - 0 `pageerror` events.
     - `tests.import.status === 'PASS'`.
     - `runner` equals `{ kind: 'playwright', engine: browserName }`.
     - `secureContext === true` and it is displayed.
     - The expected classification is derived from what the page itself observes
       (`'LanguageModel' in globalThis`), never from the engine name. If absent: `API_ABSENT`, all
       7 lifecycle checks SKIPPED, `overall === 'SKIPPED'`. If present: each lifecycle status
       follows the gate for the reported classification.
  2. **Stand-in states** via `page.addInitScript`. A stand-in `LanguageModel` whose
     `availability()` returns `downloadable`, `downloading`, `unavailable`, or an unknown string,
     or throws, or which has no `availability` at all.
     - Expected: classification and raw value per C3, all 7 BLOCKED, `overall === 'BLOCKED'`.
     - The stand-in's `create` call count stays 0, which proves no download path is taken.
     - No stand-in ever reports `available`, so no lifecycle check can PASS on a fake (FR-512).
- **What Playwright does not do**: real-model lifecycle checks, and no claims about Chrome, Edge,
  Safari, or Firefox products.
- **Alternatives rejected**:
  - Selenium or Puppeteer: no single tool drives all three engines.
  - A Node static-server dependency: `python3 -m http.server` is already the documented way to
    serve the page.

## C12. Actual Safari automation (macOS CI + safaridriver)

- **Finding**: this machine has Safari 26.3 with `/System/Cryptexes/App/usr/bin/safaridriver`.
- **Requirements for CI automation**:
  - A macOS runner. The repo has no CI workflows today (`.github/` absent), and macOS minutes are
    billed at a multiple of Linux.
  - A one-time `sudo safaridriver --enable`.
  - A WebDriver client. That means either `selenium-webdriver`, which is a second dev
    dependency, or about 40 lines of raw W3C WebDriver HTTP calls. Playwright cannot drive real
    Safari.
- **Value today**: Safari exposes no Prompt API, so it could only re-verify the `API_ABSENT`
  path. Playwright WebKit already covers that at engine level, and one manual Safari run covers
  it at product level.
- **Decision**: not in the 006 MVP. Layer 3 records actual Safari as a manual run on this Mac
  (`runner.kind: "manual", browser: "Safari"`), or NOT TESTED.
- **Upgrade path**: documented as a recipe in `smoke/README.md`. When a CI workflow exists or
  Safari gains the API, add a `ci-safari` job: macOS runner → enable safaridriver → open the page
  with `?runner=ci-safari` → read `#json`.
- WebKit results are never reported as Safari results.
