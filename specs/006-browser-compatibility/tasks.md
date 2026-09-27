---

description: "Task list for 006-browser-compatibility"
---

# Tasks: Browser Compatibility Validation

**Input**: Design documents from `/specs/006-browser-compatibility/`

**Prerequisites**: plan.md, spec.md, research.md (C1–C12), data-model.md,
contracts/result-json.md, quickstart.md; feature 005 merged (`main` = `1c6f302`)

**Tests**: Included. Three layers that never substitute for each other:
1. Node `node:test`: 98 existing tests plus `test/report.test.ts`.
2. Playwright on Chromium, Firefox, and WebKit engines.
3. Manual real browsers.

**Organization**: Verification-first. **No task changes `src/`.** If a real-browser run
reproduces an AkariSP production defect (research C10), stop and raise it as a separate
decision; do not patch `src/` inside this task list. Differences between browsers in chunking,
native messages, latency, or error names are evidence only. The `InvalidStateError` rule is
unchanged.

**Order**: gates A → J from the user request. Engine binary download is a separate,
user-confirmed prerequisite (S1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from spec.md:
  - US1: classify
  - US2: lifecycle suite
  - US3: outcome reporting
  - US4: unsupported import safety
  - US5: export
  - US6: automated cross-engine

---

## Phase 1: Setup — Gate A (baseline)

- [X] T001 Record the baseline before any edit:
  - `BASE=$(git rev-parse HEAD)`. Confirm `git status --porcelain src test smoke package.json` is
    empty.
  - `npm test` → 98/98. `npx tsc --noEmit -p .` clean. `npm run build` OK.
  - `node -e` prints 0 keys in `package.json` `dependencies`.
  - Record the five existing smoke checks as the preservation reference:
    `git show $BASE:smoke/streaming.js`, functions `normalStreaming`, `earlyBreak`,
    `callerAbort`, `shutdownDuringStreaming`, `lazyStream`. Their last real-Chrome result is 5/5,
    recorded after 005 on 2026-09-27.
  - No edit happens before this passes.

---

## Phase 2: Foundational — Gate B (result/capability model)

**Blocks all stories.** Pure logic, no DOM, no browser names.

- [X] T002 Create `smoke/report.js` (ES module, no imports, ≈ 40 lines) exporting (research C3–C6):
  - `classify({ present, hasAvailability, raw, error })` → one of `'API_ABSENT'`,
    `'API_PRESENT_UNAVAILABLE'`, `'MODEL_DOWNLOADABLE'`, `'MODEL_DOWNLOADING'`,
    `'MODEL_AVAILABLE'`, `'UNKNOWN_AVAILABILITY'`. Mapping:
    - not present → `API_ABSENT`
    - no `availability` function, or `error` set → `API_PRESENT_UNAVAILABLE`
    - `'unavailable'` → `API_PRESENT_UNAVAILABLE`
    - `'downloadable'` → `MODEL_DOWNLOADABLE`
    - `'downloading'` → `MODEL_DOWNLOADING`
    - `'available'` → `MODEL_AVAILABLE`
    - any other value → `UNKNOWN_AVAILABILITY`
  - `gate(classification, secureContext, raw)` → `null` (execute) or
    `{ status: 'SKIPPED' | 'BLOCKED', reason }`:
    - `API_ABSENT` → `SKIPPED` / `'LanguageModel API absent'`
    - `!secureContext` → `BLOCKED` / `'not a secure context'`
    - not `MODEL_AVAILABLE` → `BLOCKED` / `` `availability: ${raw ?? classification}` ``
  - `outcomeOf(error, isAssertion, seenErrors = [])`:
    - no error → `'PASS'`
    - otherwise, if any of `error`, `error.cause`, each `seen` in `seenErrors`, or each
      `seen.cause` has `name === 'NotAllowedError'` → `'BLOCKED'`. Only one `cause` level is
      checked; no deeper traversal or generic object inspection.
    - else `isAssertion` (a harness assertion or watchdog failure) → `'FAIL'`
    - else → `'FAIL'`
    - `seenErrors` is the list of native/provider errors observed during the current check
      (T007); this is how a refusal that an existing check body turned into an assertion failure
      is still BLOCKED.
  - `overall(tests, lifecycleKeys)`. Reads only `.status`, never `.info`.
    - any `FAIL` → `'FAIL'`
    - else any `BLOCKED` → `'BLOCKED'`
    - else every lifecycle key `SKIPPED` → `'SKIPPED'`
    - else every lifecycle key `PASS` → `'PASS'`
    - else → `'INCOMPLETE'`
  - `diagnose(e)` → `{ name, constructor, message, code?, causeName? }` from any thrown value
    (`constructor` = `e?.constructor?.name`)
- [X] T003 Create `test/report.test.ts` (imports `../smoke/report.js`; Node, no browser) covering:
  - every `classify` row, including the unknown value `'readily'`, a thrown error, and a missing
    `availability` function
  - every `gate` row with `secureContext = true`, and an insecure-context matrix with
    `secureContext = false` × every classification: `API_ABSENT` → `SKIPPED`; each of
    `API_PRESENT_UNAVAILABLE`, `MODEL_DOWNLOADABLE`, `MODEL_DOWNLOADING`, `MODEL_AVAILABLE`,
    `UNKNOWN_AVAILABILITY` → `BLOCKED` (a gated check is never executed, so no `create()`; no
    insecure Playwright origin is built)
  - `outcomeOf`:
    - assertion failure, no seen errors → FAIL
    - assertion failure + `seenErrors` containing a `NotAllowedError` → BLOCKED
    - assertion failure + `seenErrors` containing a `TaskError`-like `{ name: 'TaskError', cause: { name: 'NotAllowedError' } }` → BLOCKED
    - assertion failure + `seenErrors` containing only a different error (e.g. `AbortError`) → FAIL
    - non-assertion `NotAllowedError` directly and as `cause` → BLOCKED
    - other non-assertion error → FAIL
  - `overall` precedence:
    - FAIL > BLOCKED
    - all-SKIPPED → `'SKIPPED'` (never `'PASS'`)
    - all-PASS → `'PASS'`
    - partial → `'INCOMPLETE'`
    - an import FAIL makes overall FAIL
  - **INFO invariance**: for several result maps, adding
    `info: { markerObservedInOtherTask: true }` (and `false`) to any entry leaves `overall(...)`,
    the number of tests, and the PASS/FAIL/BLOCKED/SKIPPED counts identical
  - gate: `npm test` → 98 existing unchanged + these pass

**Checkpoint**: outcome math is fixed and tested before any page change

---

## Phase 3: User Story 1 + User Story 4 - Classification and import safety (P1/P2) — Gate B (page)

- [X] T004 [US1] In `smoke/streaming.html` add table rows:
  - `#ua` (label "User agent (diagnostic only)")
  - `#secure` (secure context)
  - `#classification`
  - `#overall`
  - keep `#exists` / `#availability` / `#state` / `#current`

  Also add:
  - `<pre id="json"></pre>` under a "Result JSON" heading
  - a `#setup` container for page-level buttons
  - CSS classes `.blocked` and `.skipped`, visually distinct from `.pass` / `.fail`
  - update the title and intro text to "AkariSP compatibility harness (streaming + lifecycle)".

  The file name stays the same.
- [X] T005 [US4] In `smoke/streaming.js`:
  - Replace the static `import { createRuntime, TaskError } from '../dist/index.js'` with
    module-level `let createRuntime, TaskError;` plus an `importAkariSP()` function called first
    in `main()`, so the five existing check bodies keep referencing the same names.
  - `importAkariSP()` behavior (research C2):
    - If `!('LanguageModel' in globalThis)`, install a configurable counting getter on
      `globalThis.LanguageModel` around `await import('../dist/index.js')` and delete it
      afterwards.
    - PASS if the import resolves with `createRuntime` and `TaskError` as functions and the
      getter was read 0 times.
    - Otherwise FAIL, with `diagnose(e)` or reason `'import read LanguageModel'`.
    - The result goes to `results.import`.
  - Also import `classify`, `gate`, `outcomeOf`, `overall`, and `diagnose` from `./report.js`.
- [X] T006 [US1] In `smoke/streaming.js`, add `detectCapability()` and call it after
  `importAkariSP()`:
  - `present = 'LanguageModel' in globalThis`
  - `hasAvailability = present && typeof LanguageModel.availability === 'function'`
  - `raw = await LanguageModel.availability()` (no options, as today), in `try/catch` into
    `error`; never call `create()`
  - `classification = classify(...)`
  - `secureContext = globalThis.isSecureContext === true`
  - `userAgent = navigator.userAgent`, used only for `#ua` and the JSON
  - Render `#exists`, `#availability` (raw or `n/a`), `#secure`, `#classification`, `#ua`.
  - Add a `Re-check availability` button in `#setup` that reruns `detectCapability()` and re-gates
    the not-yet-executed checks, keeping executed results.
  - Remove the old early `return`s in `main()` that hid the buttons when the model was missing;
    gating replaces them.

---

## Phase 4: User Story 3 + User Story 2 - Gated outcomes and the 7 lifecycle checks (P1) — Gate C

- [X] T007 [US3] In `smoke/streaming.js`, rework the harness around the checks without touching
  the five check bodies:
  - Give `TESTS` stable keys: `['streaming', 'Normal streaming', normalStreaming]`,
    `['earlyBreak', …]`, `['callerAbort', …]`, `['shutdownDuringStreaming', …]`,
    `['lazyStream', …]`.
  - Per-check error capture (harness helpers only; the five check bodies are not edited):
    `context()` creates a fresh `errors: []` for each check run, so nothing leaks between checks.
    `consume()` pushes the error it catches into `ctx.errors` before returning it. `describe(e)`
    takes the current check's `errors` (module-level `currentErrors`, set by `runTest` to
    `ctx.errors` at start and cleared in `finally`) and pushes `e` when it is not a
    `SmokeFailure`. `runTest` passes `ctx.errors` as `seenErrors` to `outcomeOf`.
  - Keep one module-level `results` object:
    `{ import, <key>: { status, reason?, durationMs?, error?, info? } }`.
  - `runTest` behavior:
    - First apply `gate(...)`. If gated, record that outcome with its reason and do not execute.
    - Otherwise execute as today, measuring `durationMs`.
    - Map the outcome with `outcomeOf(failure, failure instanceof SmokeFailure, ctx.errors)`.
      The watchdog already throws `SmokeFailure`.
    - Store `diagnose(failure)` when failed or blocked, and `reason` = the failure message's first
      line.
    - Cleanup shutdown stays as is.
  - On page load, record the gated outcome for every lifecycle check. Executable checks stay
    unrecorded ("not run").
  - Always render one button per check plus `Run All`:
    - `Run All` runs every check and never stops at the first failure.
    - A check refused during Run All is BLOCKED and can be rerun from its own button; the rerun
      replaces the stored result.
  - Results rendering: `[STATUS] name` with the class for its status, plus the reason for any
    non-PASS status.
  - After every change, update `#overall` = `overall(results, LIFECYCLE_KEYS)`.
  - `git diff $BASE -- smoke/streaming.js` shows no line changed inside the five check functions.
- [X] T008 [US2] In `smoke/streaming.js`, add `async function normalRun(ctx)` with key `run`,
  placed first in `TESTS` (research C7):
  - `rt = await ctx.runtime({ limit: 1, queueCapacity: 0 })`
  - `r = await rt.run(SHORT_PROMPT)`
  - Checks:
    - `typeof r.output === 'string' && r.output.length > 0`
    - `typeof r.timing.total === 'number'`, and the same for `typeof r.timing.prompt`
    - `rt.state === 'ready'`
    - a second `rt.run(SHORT_PROMPT)` resolves (reusable)
    - `await rt.shutdown()` resolves and `rt.state === 'closed'`
  - `ctx.note` the output length only; never the text as an assertion.
- [X] T009 [US2] In `smoke/streaming.js`, add `async function cloneIsolation(ctx)` with key
  `cloneIsolation`, placed last in `TESTS` (research C7):
  - `marker` = 8 hex chars from `crypto.getRandomValues(new Uint8Array(4))`
  - `rt = await ctx.runtime()`
  - `a = await rt.run(\`Remember the code word ${marker}. Reply with OK.\`)`
  - `b = await rt.run('If you were told a code word earlier in this conversation, repeat it. Otherwise reply NONE.')`
  - `c = await rt.run(SHORT_PROMPT)`
  - Checks, all completed first: each `.output` is a string, `rt.state === 'ready'`,
    `await rt.shutdown()` resolves, and `rt.state === 'closed'`.
  - Only after every structural check has passed, set
    `ctx.info = { marker, markerObservedInOtherTask: b.output.includes(marker) }`, and have
    `runTest` copy `ctx.info` into `results.cloneIsolation.info`. The INFO computation is the last
    statement, so it cannot decide PASS/FAIL.
  - INFO never feeds the status or any check. Extend `context()` with `info: undefined`.

---

## Phase 5: User Story 5 - JSON, INFO, runner metadata (P2) — Gate D

- [X] T010 [US5] In `smoke/streaming.js`, add `resultDocument()` and render it into `#json` after
  every change. Shape: [contracts/result-json.md](contracts/result-json.md).
  - Top-level fields: `recordedAt` (ISO, at render), `runner`, `userAgent`, `secureContext`.
  - `capability`: `{ languageModelPresent, availability: raw ?? null, classification,
    error: diagnose(error) | null }`.
  - `tests`: `results`, including `info`.
  - `overall`.
  - `runner` comes from URL parameters only (`new URLSearchParams(location.search)`), never from
    the UA:
    - `runner=playwright` → `{ kind: 'playwright', engine: params.get('engine') }`
    - `runner=ci-safari` → `{ kind: 'ci-safari' }`
    - otherwise → `{ kind: 'manual', browser: params.get('browser') }`
  - Add a `Copy JSON` button in `#setup` that calls
    `navigator.clipboard.writeText(#json text)` from the click. On rejection, log
    "copy failed; select the JSON block manually"; the block is always visible.
  - After the first complete render (import + capability + gating), set
    `document.body.dataset.ready = 'true'` so automation can wait for it.
  - No `fetch`, `sendBeacon`, `XMLHttpRequest`, or `WebSocket`, and no storage.

**Checkpoint (Gate C/D)**: `npm run build && python3 -m http.server 8080`, open the page in any
local browser → it renders capability, outcomes, overall, and JSON with 0 console errors (quick
manual look; full validation in Phase 9)

---

## Phase 6: User Story 6 - Playwright configuration (P2) — Gate E

- [X] T011 [US6] Add Playwright as a dev dependency only:
  - `npm i -D @playwright/test`. This downloads the npm package only; engine binaries are not
    fetched by this command. Add no `postinstall`.
  - `package.json` gains `"test:browser": "playwright test"`. `dependencies` stays absent and
    `npm test` is unchanged.
  - Commit the resulting `package-lock.json` update (the repo uses npm).
  - Add `test-results/`, `playwright-report/`, and `blob-report/` to `.gitignore`.
  - Engine binaries live outside the repo (Playwright's user cache) and are never committed or
    packaged; `package.json` `files` stays `["dist"]`.
  - Create `playwright.config.ts`:
    - `testDir: 'e2e'`
    - `projects`: `chromium`, `firefox`, and `webkit`, each with `use: { browserName }`
    - `use.baseURL: 'http://localhost:8080'`
    - `webServer: { command: 'npm run build && python3 -m http.server 8080', url: 'http://localhost:8080/smoke/streaming.html', reuseExistingServer: true }`
  - Gate: `npm test` still passes, and `npx playwright --version` prints.
- [X] S1 ⛔ **Setup prerequisite, user-confirmed (not an implementation task)**: engine binaries
  via `npx playwright install chromium firefox webkit`, several hundred MB. `/speckit-implement`
  MUST stop here and ask the user before running it, and MUST NOT run it from any script. If
  declined, Phases 7–8 stay unrun and are reported as such.

---

## Phase 7: User Story 6 - Shared cross-engine test (P2) — Gate F

- [X] T012 [US6] Create `e2e/compatibility.spec.ts`: one file for all 3 projects, with no engine
  name in any expectation.
  - Helper `load(page, browserName, init?)`:
    - optional `page.addInitScript(init)`
    - collect `page.on('pageerror')`
    - `page.goto('/smoke/streaming.html?runner=playwright&engine=' + browserName)`
    - wait for `body[data-ready="true"]`
    - return `JSON.parse(#json text)` and the errors
  - Test "native capability" (no injection):
    - 0 page errors
    - `tests.import.status === 'PASS'`
    - `runner` deep-equals `{ kind: 'playwright', engine: browserName }`
    - `secureContext === true`, and `#secure` shows it
    - `#ua` is non-empty
    - `present = await page.evaluate(() => 'LanguageModel' in globalThis)`
    - If `!present`: `capability.classification === 'API_ABSENT'`, all 7 lifecycle keys
      `SKIPPED` with a `reason`, and `overall === 'SKIPPED'`.
    - If present, assert only consistency: each lifecycle status equals the gate for the reported
      classification, i.e. BLOCKED unless `MODEL_AVAILABLE`, in which case it is absent (not run).
    - The spec never clicks a lifecycle button, so no model download or real inference can start.
      This is capability evidence only; it never substitutes for Layer 3.
  - Assert the JSON has exactly the top-level keys `recordedAt`, `runner`, `userAgent`,
    `secureContext`, `capability`, `tests`, `overall`, and that `capability` has
    `languageModelPresent`, `availability`, `classification`, `error`.

---

## Phase 8: User Story 6 - Injected capability states (P2) — Gate G

- [X] T013 [US6] In `e2e/compatibility.spec.ts`, add a parameterized test over stand-in APIs
  injected with `page.addInitScript` before page scripts run.
  - Each stand-in sets `globalThis.__creates = 0` and
    `globalThis.LanguageModel = { create() { globalThis.__creates++; throw new Error('stand-in'); }, … }`
    plus the per-case `availability`.
  - Cases (no `available` case exists):

    | Case | `availability` | Expected `classification` | Expected `availability` in JSON |
    |---|---|---|---|
    | unavailable | resolves `'unavailable'` | `API_PRESENT_UNAVAILABLE` | raw |
    | downloadable | resolves `'downloadable'` | `MODEL_DOWNLOADABLE` | raw |
    | downloading | resolves `'downloading'` | `MODEL_DOWNLOADING` | raw |
    | unknown | resolves `'future-state-x'` | `UNKNOWN_AVAILABILITY` | `'future-state-x'` |
    | throws | rejects with `new DOMException('x', 'NotSupportedError')` | `API_PRESENT_UNAVAILABLE` | `null`; `capability.error.name === 'NotSupportedError'` |
    | missing | property absent | `API_PRESENT_UNAVAILABLE` | `null` |

  - For every case:
    - `languageModelPresent === true`
    - all 7 lifecycle checks `BLOCKED` with a `reason`
    - `overall === 'BLOCKED'`
    - `tests.import.status === 'PASS'`
    - `await page.evaluate(() => globalThis.__creates) === 0`
    - 0 page errors
  - Also, for the `downloadable` case, click every lifecycle button and `Run All`; afterwards
    `__creates` is still 0 and the statuses are still BLOCKED.

---

## Phase 9: Polish — Gate H (full automated regression)

- [X] T014 Full automated regression:
  - Layer 1: `npm test` → 98 existing unchanged + `test/report.test.ts` pass.
  - `npx tsc --noEmit -p .` clean. `npm run build` OK.
  - Layer 2 (only if S1 was done): `npm run test:browser` passes on Chromium, Firefox, and
    WebKit.
  - Record per-engine pass/fail and the native classification each engine showed in
    `smoke/README.md` (T015) as Layer 2 results. They are labeled as engines, never as Chrome,
    Firefox, or Safari products.
- [X] T015 [P] Update `smoke/README.md`:
  - Rename the section to a compatibility harness overview, keeping the run instructions.
  - URL parameters (`?browser=`, `?runner=playwright&engine=`).
  - The 3 layers and what each proves, with "Playwright WebKit ≠ Safari" and "automated engines
    never replace real-model lifecycle evidence".
  - Classification table, outcome definitions, overall rules (including `INCOMPLETE`), and that
    INFO never affects outcomes.
  - The 7-check table: the existing 5 rows unchanged, plus normal run and clone isolation.
  - The evidence-file convention `smoke/results/<YYYY-MM-DD>-<os>-<browser><major>.json`, marked
    "dated evidence, not a support table, read by nothing".
  - The validation matrix with every Layer 3 row `NOT TESTED`.
  - An "Actual Safari automation (not in 006)" recipe: macOS runner →
    `sudo safaridriver --enable` → W3C WebDriver session → open the page with
    `?runner=ci-safari` → read `#json`.
- [X] T016 [P] Add a short capability-based note to `README.md` (for example under Development):
  - AkariSP uses the Prompt API exposed by the current browser.
  - Importing AkariSP is safe in any browser; that does not mean the browser can run a model.
  - Use `smoke/streaming.html` to inspect a specific browser and version.
  - No static per-browser support table.

---

## Phase 10: Real-browser evidence — Gate I (manual, user-run; Layer 3)

Each task:
1. Serve with `npm run build && python3 -m http.server 8080`.
2. Open `http://localhost:8080/smoke/streaming.html?browser=<Name>`.
3. Run the executable checks individually or with Run All.
4. Copy JSON and save it as `smoke/results/<YYYY-MM-DD>-<os>-<name><major>.json`.
5. Update that row of the matrix in `smoke/README.md`.

Only runs actually performed produce a file; otherwise the row stays `NOT TESTED`. No outcome is
predicted.

- [X] T017 Chrome desktop (real model available) → expected import PASS and 7 lifecycle PASS,
  including the 5 preserved checks; save evidence.
- [X] T018 Edge desktop → record the actual classification. If `MODEL_AVAILABLE`, run the 7
  checks; otherwise lifecycle is BLOCKED/SKIPPED as reported. Save evidence or mark NOT TESTED.
- [X] T019 Safari desktop (manual; this Mac has Safari 26.3) → record the actual capability. Save
  as `runner.kind: 'manual', browser: 'Safari'`, or mark NOT TESTED.
- [X] T020 Firefox desktop → record the actual capability. Save evidence or mark NOT TESTED.
- If any lifecycle check FAILs for an AkariSP reason: stop, record the evidence, and raise a
  separate production decision. No `src/` edit in this feature.

---

## Phase 11: Final verification — Gate J

- [X] T021 Final verification:
  - A. `npm test` (98 existing unchanged + report tests), `tsc`, build.
  - B. Playwright passes on the 3 engines (or states why not run, if S1 was declined).
  - C. Layer 3 files only for runs actually performed; the matrix shows the rest as NOT TESTED.
  - `git diff $BASE -- src/` is empty.
  - `git diff $BASE -- package.json` shows only `devDependencies["@playwright/test"]` and the
    `test:browser` script; `dependencies` is absent; there is no `postinstall`.
  - The five check function bodies are unchanged vs `$BASE`.
  - `grep -n userAgent smoke/streaming.js` shows display/JSON use only.
  - `grep -rnE "fetch\(|sendBeacon|XMLHttpRequest|WebSocket|localStorage" smoke/` → nothing.
  - `grep -rn "LanguageModel.create" smoke/ e2e/` → only the stand-in definitions in
    `e2e/compatibility.spec.ts`.
  - `grep -rn "results/" src smoke/*.js e2e` → no code reads evidence files.
  - No Playwright or evidence label calls WebKit "Safari".
  - The INFO invariance test passes.
  - Final report MUST print these six rows separately:

    | Row | Value |
    |---|---|
    | Node automated | PASS / FAIL (with counts) |
    | Playwright engines | PASS / FAIL per engine, or NOT RUN if S1 was declined |
    | Actual Chrome | actual result, or NOT TESTED |
    | Actual Edge | actual result, or NOT TESTED |
    | Actual Safari | actual result, or NOT TESTED |
    | Actual Firefox | actual result, or NOT TESTED |

    NOT TESTED and NOT RUN are never counted or reported as FAIL.

---

## Dependencies & Execution Order

- T001 (A) → T002 → T003 (B) → T004 → T005 → T006 (B/page) → T007 → T008 → T009 (C) →
  T010 (D) → T011 (E) → **S1 (user-confirmed)** → T012 (F) → T013 (G) → T014 (H) →
  T017–T020 (I) → T021 (J)
- T015 and T016 are `[P]`: docs only. They can run any time after T010 and must be done before
  T017, which updates the matrix row in T015's README.
- T017–T020 are manual and independent of each other; the user can run them in any order.
- Engine binary download first becomes necessary at S1 (before T012). Everything before S1 needs
  no binaries.

## Implementation Strategy

**MVP = T001–T016 + S1**: tested outcome logic, the 7-check capability-gated harness, JSON with
runner and INFO, and the Playwright layer on 3 engines, with docs. Layer 3 (T017–T020) is
user-run evidence. T021 closes the feature.

## Notes

- New dependency: dev `@playwright/test` only. Runtime dependencies stay 0. No UA parser,
  Selenium, Puppeteer, detection, schema, or telemetry package.
- No `src/` task. No actual-Safari CI task; it is documented only (T015).
- Stand-ins exist only in `e2e/` and never report `available`.
