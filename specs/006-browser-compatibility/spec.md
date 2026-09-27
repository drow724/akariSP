# Feature Specification: Browser Compatibility Validation

**Feature Branch**: `006-browser-compatibility`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Add multi-browser compatibility validation to AkariSP. Classify the
actual Prompt API capability of the running browser (absent, present but unavailable,
downloadable, downloading, available), run the shared real-browser lifecycle suite where a model
is usable, verify import safety and graceful reporting where it is not, never download a model
automatically, and report PASS / FAIL / BLOCKED / SKIPPED with diagnostics and a local JSON
export. No new provider, no production API, no browser-name routing, no telemetry."

## Clarifications

### Session 2026-09-27

- Q: How is clone isolation verified on a real model? → A: Option C. A marker probe runs and its
  observation is recorded as INFO (diagnostic evidence); the check's PASS/FAIL is decided by the
  structural checks only (both tasks complete, the base stays reusable). Isolation itself remains
  proven by the automated unit tests.
- Q: Harness structure? → A: Option C. Extend the existing streaming smoke harness into the
  compatibility harness (one page, one script). Renaming files is not required. The existing five
  lifecycle checks are preserved as they are.
- Q: Recorded results? → A: Option A. Exported JSON files are committed under `smoke/results/`
  as dated compatibility evidence (with browser version and recording time), not as a current
  support table, and are never used for any production capability decision.
- INFO is diagnostic evidence only, separate from PASS / FAIL / BLOCKED / SKIPPED, and never
  affects any check outcome or the overall result.
- Test strategy revised: validation uses three layers that never substitute for each other —
  (1) existing automated runtime tests (Node, fake provider); (2) automated cross-engine harness
  tests with Playwright on Chromium, Firefox, and WebKit; (3) real branded-browser evidence
  (Chrome / Edge with a real model; Safari / Firefox where practical). Playwright is allowed as a
  dev dependency and is in the MVP. Real-model lifecycle checks are NOT replaced by Playwright.
  Whether actual-Safari automation (macOS CI + safaridriver) is in the MVP is decided in planning
  by cost. Playwright WebKit results are never reported as Safari results.

## User Scenarios & Testing *(mandatory)*

Actors:
- **AkariSP maintainer / contributor** who opens the compatibility page in a given desktop
  browser and records the result.
- **Application developer** evaluating AkariSP, who needs to know what AkariSP guarantees versus
  what depends on the user's browser.

### User Story 1 - Classify the running browser's capability (Priority: P1)

A maintainer opens the compatibility page in any desktop browser. The page immediately shows,
from the browser's own features: whether the built-in language model API exists, the model
availability value the browser reports, whether the page runs in a secure context, and the
browser's user agent string (for the record only). It never starts a model download.

**Why this priority**: Every other decision (run, block, skip) depends on a correct
classification; a wrong one either hides AkariSP defects or blames AkariSP for the environment.

**Independent Test**: Open the page in a browser with the API absent, and in one with the API
present; each shows the correct category and the raw availability value, and no download starts.

**Acceptance Scenarios**:

1. **Given** a browser without the built-in language model API, **When** the page loads,
   **Then** it shows capability `API_ABSENT`, availability "n/a", and stays fully usable.
2. **Given** a browser with the API, **When** the page loads, **Then** it queries the browser's
   own availability mechanism, shows the exact value returned, and maps it to one of
   `API_PRESENT_UNAVAILABLE`, `MODEL_DOWNLOADABLE`, `MODEL_DOWNLOADING`, `MODEL_AVAILABLE`, or
   `UNKNOWN_AVAILABILITY` for an unrecognized value.
3. **Given** any browser, **When** the page loads, **Then** it shows whether the page is a secure
   context, and the user agent is labeled "diagnostic only".
4. **Given** availability indicates a download is needed or in progress, **When** the page loads
   or any test runs, **Then** no session creation or other call that could start a download is
   made.
5. **Given** the classification logic, **When** it is inspected, **Then** no decision depends on
   the browser name or user agent string.

---

### User Story 2 - Run the shared lifecycle suite where a model is usable (Priority: P1)

In a browser whose model is available, the maintainer runs the same lifecycle checks regardless
of brand: normal run, normal streaming, early break, caller abort, shutdown during streaming,
lazy stream, and clone isolation. Each check is a separate button; a "Run All" convenience
exists but is not required.

**Why this priority**: This is the actual cross-browser guarantee: AkariSP's lifecycle semantics
hold on any conforming implementation.

**Independent Test**: In a browser with `MODEL_AVAILABLE`, each check passes individually by its
own button; results never depend on output text, chunk counts, or timing values.

**Acceptance Scenarios**:

1. **Given** `MODEL_AVAILABLE`, **When** "Normal run" runs, **Then** a result string is returned,
   the runtime is still ready, and shutdown completes.
2. **Given** `MODEL_AVAILABLE`, **When** "Normal streaming" runs, **Then** at least one text chunk
   arrives, iteration completes, timing is published after completion, and shutdown completes.
3. **Given** `MODEL_AVAILABLE`, **When** "Early break" runs, **Then** leaving after the first chunk
   completes cleanup and a following task can start.
4. **Given** `MODEL_AVAILABLE`, **When** "Caller abort" runs, **Then** the task ends with AkariSP's
   `cancelled` code, cleanup completes, and the runtime accepts a new task.
5. **Given** `MODEL_AVAILABLE`, **When** "Shutdown during streaming" runs, **Then** the stream ends
   with `cancelled`, shutdown resolves, and the runtime is closed.
6. **Given** `MODEL_AVAILABLE`, **When** "Lazy stream" runs, **Then** an unconsumed stream holds no
   capacity, does not delay shutdown, and its first consumption after shutdown reports `closed`.
7. **Given** `MODEL_AVAILABLE`, **When** "Clone isolation" runs, **Then** two tasks from the same
   warm base both complete, the base remains reusable for a third task, and shutdown completes
   (PASS/FAIL); in addition, task 1 is given a unique random marker and task 2 is asked to repeat
   any marker it was given, and whether task 2's output contains the marker is recorded as INFO
   evidence only, never as PASS or FAIL.
8. **Given** any check, **When** it is started from its own button, **Then** it runs independently
   of "Run All" and of other checks.

---

### User Story 3 - Report environment blocking separately from AkariSP failure (Priority: P1)

When a check cannot run because of the environment (API absent, model not installed or
downloading, unavailable, insecure context, permission or activation refusal), the page reports
BLOCKED or SKIPPED with a reason instead of FAIL. When a check runs and AkariSP's promised
behavior does not hold, it reports FAIL. Native error details are shown for diagnosis.

**Why this priority**: Without this distinction the results are useless across browsers.

**Independent Test**: In a browser with the API absent, every model-dependent check shows SKIPPED
with a reason and the import check shows PASS; in a browser with a downloadable model, model
checks show BLOCKED.

**Acceptance Scenarios**:

1. **Given** `API_ABSENT`, **When** any model-dependent check is started, **Then** it is SKIPPED
   with reason "API absent" and nothing is executed.
2. **Given** `API_PRESENT_UNAVAILABLE`, `MODEL_DOWNLOADABLE`, `MODEL_DOWNLOADING`, or an insecure
   context, **When** a model-dependent check is started, **Then** it is BLOCKED with the reason and
   nothing is executed.
3. **Given** a check that fails because the browser refuses the operation for environment reasons
   (for example a permission or user-activation refusal), **When** it ends, **Then** it is BLOCKED
   with the native error details, not FAIL — including when the refusal was observed inside a
   check and surfaced as an assertion failure.
4. **Given** a check where AkariSP's contract does not hold (for example an abort that does not end
   with `cancelled`), **When** it ends, **Then** it is FAIL.
5. **Given** any error, **When** it is recorded, **Then** the page shows its name, constructor
   name, message, and, for task errors, the task error code and cause name; PASS/FAIL never
   depends on a message string.

---

### User Story 4 - Unsupported browsers load AkariSP safely (Priority: P2)

In a browser without the API (for example current desktop Firefox or Safari), the page loads the
built AkariSP package, confirms the import succeeded without touching the model API, and
reports the absence clearly. No fake provider is used to produce artificial passes.

**Why this priority**: Import safety is AkariSP's guarantee in every browser; inference is not.

**Independent Test**: Open the page in a browser without the API: the import check is PASS, the
page is usable, and model checks are SKIPPED.

**Acceptance Scenarios**:

1. **Given** `API_ABSENT`, **When** the page loads, **Then** importing the built package succeeds
   and the import check reports PASS.
2. **Given** `API_ABSENT`, **When** the page loads, **Then** importing AkariSP does not attempt to
   access or create a model.
3. **Given** the page in any browser, **When** it runs, **Then** it never substitutes a fake or
   fallback model.

---

### User Story 5 - Record and export results locally (Priority: P2)

After running checks, the maintainer copies a small machine-readable result (browser label,
secure context, API presence, raw availability, capability category, per-check outcome and reason,
diagnostic errors) from the page. Nothing is sent anywhere.

**Why this priority**: Makes the cross-browser matrix easy to record without telemetry.

**Independent Test**: Run some checks, press "Copy JSON"; the clipboard/rendered block contains
the current results; the network shows only static file requests.

**Acceptance Scenarios**:

1. **Given** results on the page, **When** the maintainer presses the copy control, **Then** the
   JSON result is copied and also rendered on the page for manual copy.
2. **Given** the page's whole lifetime, **When** network activity is inspected, **Then** only the
   page's own static files are requested.

---

### User Story 6 - Automated cross-engine harness checks (Priority: P2)

A contributor runs one command that loads the compatibility page in automated Chromium, Firefox,
and WebKit engines and verifies the harness itself: the page loads, AkariSP imports without a
crash, the capability each engine actually exposes is classified correctly, environment-gated
checks get the right outcome, and the JSON result has the right shape and identifies the runner.

**Why this priority**: Catches harness and import-safety regressions in three engines on every
run, without a real model; it does not replace real-browser evidence.

**Independent Test**: Run the automated browser suite; it passes on all three engines whatever
capability each engine exposes.

**Acceptance Scenarios**:

1. **Given** each automated engine, **When** the page loads, **Then** there are 0 uncaught page
   errors, the import check is PASS, and the classification matches the capability the engine
   actually exposes (no per-engine expected outcome is hard-coded).
2. **Given** an engine where the API is absent, **When** the page loads, **Then** the 7 lifecycle
   checks are SKIPPED and the overall result is SKIPPED, never PASS.
3. **Given** a test-injected stand-in API that reports a not-ready, unknown, or failing
   availability, **When** the page loads, **Then** the classification and raw value are correct,
   lifecycle checks are BLOCKED, and the stand-in's session creation is never called.
4. **Given** any automated run, **When** the JSON is read, **Then** it identifies the runner as
   automated with its engine name, and a WebKit run is never labeled as Safari.

---

### Edge Cases

- The browser reports an availability value the page does not recognize: show the raw value,
  classify as `UNKNOWN_AVAILABILITY` (never guessed into another category), and block model
  checks.
- The availability query itself throws or rejects: record the error, classify as
  `API_PRESENT_UNAVAILABLE`, block model checks.
- The API object exists but lacks the availability query: classify as `API_PRESENT_UNAVAILABLE`
  with reason "no availability query"; do not call session creation to probe.
- The page is not a secure context: report it; model checks are BLOCKED with that reason.
- Availability changes while the page is open (a manual download finishes): the maintainer can
  re-check availability without reloading; results already recorded are kept.
- "Run All" loses the browser's transient user activation: a check that then gets an activation
  refusal is BLOCKED, and the same check can be re-run from its own button.
- A check hangs because of the environment: a harness watchdog ends it as FAIL with "timed out"
  (as in the existing smoke page), and the runtime it created is still shut down.
- A clone failure with an "invalid state" error in some browser: recorded as evidence; AkariSP's
  broken rule is not changed by this feature.
- Mobile browsers: out of scope; results from desktop are never claimed for mobile.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-501**: A compatibility page MUST classify the running browser into exactly one of
  `API_ABSENT`, `API_PRESENT_UNAVAILABLE`, `MODEL_DOWNLOADABLE`, `MODEL_DOWNLOADING`,
  `MODEL_AVAILABLE`, `UNKNOWN_AVAILABILITY`, using only the presence of the browser's language
  model API and the browser's own availability query; it MUST display the raw availability value
  as returned. Only the four known values map to model states; any other value is
  `UNKNOWN_AVAILABILITY`.
- **FR-502**: No classification or execution decision MAY depend on the browser name or user
  agent; the user agent MAY be displayed and exported as a diagnostic label only.
- **FR-503**: The page MUST display: user agent (diagnostic only), API presence, raw availability,
  capability category, secure-context status, each check's outcome, and diagnostic errors.
- **FR-504**: The page MUST NOT start or trigger a model download: before any model-dependent
  check it MUST confirm `MODEL_AVAILABLE` and a secure context, and otherwise not execute the
  check.
- **FR-505**: Each check MUST end in exactly one outcome: PASS (ran, AkariSP contract held), FAIL
  (ran, contract did not hold or harness watchdog timed out), BLOCKED (not run or aborted by an
  environment condition: API present but not usable, model not available, insecure context, or a
  native permission / activation refusal), SKIPPED (not applicable: API absent). Every
  non-PASS outcome MUST carry a reason.
- **FR-506**: The page MUST include an import check that passes when the built AkariSP package
  loads, in every browser, without the model API being accessed.
- **FR-507**: When a model is usable, the page MUST provide these lifecycle checks, each with its
  own button: normal run, normal streaming, early break, caller abort, shutdown during streaming,
  lazy stream, clone isolation. A "Run All" control MAY exist as a convenience.
- **FR-508**: Lifecycle checks MUST assert only AkariSP semantics (result/chunk types, at least
  one chunk, completion, cleanup, slot release, error codes, runtime state, timing presence) and
  MUST NOT assert output text, chunk counts or boundaries, latency, token counts, or model name.
- **FR-509**: For every error, the page MUST record name, constructor name, and message, and for
  AkariSP task errors also the code and cause name; outcomes MUST NOT depend on message strings.
- **FR-510**: The clone isolation check's outcome MUST be decided only by structural checks
  (two tasks from the same warm base complete, the base serves a third task, shutdown completes).
  The marker probe (US2/AC7) MUST be recorded as INFO evidence and MUST NOT affect the check's
  outcome. Isolation of task state is proven by the automated unit tests, not by model output.
- **FR-510a**: INFO MUST be a separate diagnostic field, distinct from the four outcomes; it MUST
  NOT change any check outcome, the pass count, or any summary.
- **FR-511**: The page MUST let the maintainer copy the current results as a small JSON document
  and MUST also render it on the page; nothing MAY be sent over the network beyond loading the
  page's own static files. No analytics, telemetry, fingerprinting, or uploads.
- **FR-512**: The page MUST NOT use a fake, polyfill, or fallback model. Automated tests MAY
  inject a stand-in API only to exercise classification and gating for states that are not
  "available"; a stand-in MUST never make a lifecycle check PASS.
- **FR-513**: The compatibility harness MUST be the existing streaming smoke harness extended in
  place (one page, one script); renaming its files is not required. The existing five lifecycle
  checks (normal streaming, early break, caller abort, shutdown during streaming, lazy stream)
  MUST keep their assertions; they only gain the capability gating and the four-outcome
  reporting. In the reference browser they MUST still all pass.
- **FR-514**: Production source, public API, error types, and runtime semantics MUST remain
  unchanged; all existing automated tests (98) MUST pass unmodified. If a real incompatibility
  requires a production change, it MUST be raised as a separate decision, not made silently.
- **FR-515**: The feature MUST NOT add runtime dependencies, a
  second provider, polyfills, fallbacks, provider selection, browser-name routing, a capability
  framework in core, or a public compatibility API.
- **FR-518**: An automated browser suite MUST run the compatibility page in Chromium, Firefox,
  and WebKit engines through one shared test file, verifying: page load without page errors,
  import success, classification consistent with the engine's actual capability, SKIPPED /
  BLOCKED gating, the outcome and overall rules, secure-context display, raw preservation of an
  unknown availability value, and the JSON shape. It MUST NOT branch on engine name for expected
  outcomes. The automation tool MAY be added as a dev dependency only.
- **FR-519**: Every result document MUST identify its runner: automated runs as
  `{ kind: "playwright", engine: "chromium" | "firefox" | "webkit" }`, manual runs as
  `{ kind: "manual", browser: <label given by the person running it, or null> }`, and an
  actual-Safari automated run, if ever added, as `{ kind: "ci-safari" }`. The runner is declared
  by whoever launches the page, never inferred from the user agent.
- **FR-520**: Evidence layers MUST NOT substitute for each other: automated engine results are
  harness/web-compatibility evidence; real Chrome / Edge results are real-model lifecycle
  evidence; real Safari / Firefox results are branded-browser capability evidence. A WebKit
  engine result MUST NOT be recorded or described as a Safari result, and the 7 real-model
  lifecycle checks MUST NOT be considered verified by automated engines.
- **FR-516**: Documentation MUST distinguish "AkariSP loads safely in this browser" from "this
  browser provides a built-in language model", avoid static per-browser support claims, and point
  to the compatibility page for environment-specific results.
- **FR-517**: Exported results MAY be committed under `smoke/results/` as dated compatibility
  evidence. Each result document MUST include the browser-reported user agent (which carries the
  browser version) and the recording time. These files are evidence of what was observed at that
  time, not a support table, and nothing in production code or in the page's classification MAY
  read them.

### Key Entities

- **Capability report**: user agent (label), secure context, API present, raw availability,
  capability category, availability error (if any).
- **Check result**: check name, outcome (PASS / FAIL / BLOCKED / SKIPPED), reason, diagnostic
  error fields.
- **Check result** also carries an optional INFO note (diagnostic evidence, e.g. the clone
  isolation marker observation) that never affects the outcome.
- **Result document**: recording time, runner, capability report, all check results, and the
  overall result, as exported JSON.
- **Overall result**: one of PASS, FAIL, BLOCKED, SKIPPED, INCOMPLETE, computed from check
  outcomes only (never INFO): any FAIL → FAIL; else any BLOCKED → BLOCKED; else all 7 lifecycle
  checks SKIPPED → SKIPPED; else all 7 PASS → PASS; else INCOMPLETE (some executable checks not
  run yet, e.g. an automated run that observes `MODEL_AVAILABLE` but never runs lifecycle checks).
  INCOMPLETE is an overall value only, never a check outcome. Committed copies under `smoke/results/` are dated evidence only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-501**: 98/98 existing automated tests pass unmodified; production source and public API are
  unchanged.
- **SC-502**: In the reference browser with an available model, all 7 lifecycle checks and the
  import check are PASS, including the 5 preserved streaming checks.
- **SC-503**: In a browser without the API, the page loads with 0 uncaught errors, the import
  check is PASS, and 100% of model checks are SKIPPED with a reason.
- **SC-504**: In a browser whose model is downloadable or downloading, 0 downloads are started by
  the page and 100% of model checks are BLOCKED with a reason.
- **SC-505**: Each of the 4 outcomes is visually and textually distinct, and every non-PASS
  outcome shows a reason.
- **SC-506**: The page makes 0 network requests other than its own static files.
- **SC-507**: The exported JSON contains the recording time, the capability report, and every
  check's outcome (plus any INFO), and is obtainable in one action.
- **SC-510**: Real-browser evidence: at least one dated manual result file per desktop branded
  browser actually run is committed under `smoke/results/`, identified by its runner; browsers
  not run are listed as "NOT TESTED" in the harness docs. Automated engine results are never
  counted toward this criterion.
- **SC-511**: The automated browser suite passes on all 3 engines (Chromium, Firefox, WebKit) with
  0 page errors and no hard-coded per-engine outcome.
- **SC-508**: The classification and execution code contains 0 decisions based on browser name or
  user agent.
- **SC-509**: Runtime dependency count stays 0; the only added dependency is the browser
  automation tool as a dev dependency.

## Assumptions

- The built-in language model API's availability values are those the browser returns today
  (for the reference browser: "unavailable", "downloadable", "downloading", "available"); the
  page maps these and records any other value raw as `UNKNOWN_AVAILABILITY`.
- The availability query is called exactly as the existing smoke page calls it (no options): the
  checks' session configuration contains no availability-relevant field, so the answer is the
  same, and the working reference-browser call is not changed. The query never starts a
  download.
- BLOCKED vs SKIPPED: SKIPPED means "not applicable in this browser" (API absent); BLOCKED means
  "applicable but the environment prevents it now" (model not ready, insecure context, native
  refusal).
- Native permission or activation refusals are recognized by standard error names (for example
  `NotAllowedError`) and reported as BLOCKED with details; any other error in a check that ran is
  judged against AkariSP's contract.
- The page is served locally from the built package over a trustworthy local origin
  (`localhost`), as the existing smoke and benchmark pages are.
- Validation has three layers (see Clarifications). Real-browser validation covers desktop
  Chrome, Edge, Firefox, and Safari as available to the maintainer; a browser not run is recorded
  as "NOT TESTED", never assumed, and never inferred from an automated engine result.
- Automated engines are expected to lack a usable built-in model; that is an expected capability
  path, not a failure.
- The InvalidStateError broken rule stays exactly as preserved in 005; different real behavior in
  another browser is recorded as evidence only.
- Mobile browsers are out of scope.
