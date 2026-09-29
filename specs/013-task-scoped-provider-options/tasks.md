---

description: "Task list for 013-task-scoped-provider-options"
---

# Tasks: Task-Scoped Provider Options Boundary Validation

**Input**: Design documents from `/specs/013-task-scoped-provider-options/`

**Prerequisites**: plan.md, spec.md (clarified: Q1 sample and rule, Q2 one-provider extension, Q3
workaround rule), research.md (fixed R1 protocol), data-model.md,
contracts/evidence-and-decision.md, quickstart.md (V1–V6).

**Tests**: only the assert-based stand-in check of the research calculations (plan: Testing). No
library tests are added in Stages 1–2.

**Scope boundary**:
- Stages 1–2 change **no** `src/`, `test/`, `api/`, `README.md`, or `package.json`.
- If the decision (T009) is INTERNAL_ONLY or PUBLIC_MINIMAL_EXTENSION, stop after T010. User
  Story 3 tasks are generated only after a plan amendment is approved.
- Do not implement fence stripping, JSON parsing, retries, or schema handling in AkariSP (FR-1340).
- Do not edit or drop raw attempts.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 establishes the R1 evidence, US2 records the decision, and US3 covers existing
  callers and lifecycle (conditional)

---

## Phase 1: Setup

- [X] T001 Record the baseline in a new "Implementation evidence" section at the end of
  `specs/013-task-scoped-provider-options/research.md`:
  - `npm test` (expect 146/146);
  - `npx tsc --noEmit`;
  - `npm run test:browser` (expect 21/21);
  - `shasum api/akarisp.api.txt`.

  No code changes.

---

## Phase 2: Foundational (blocks US1)

- [X] T002 Create `experiments/structured-output/rules.js`. It holds pure functions only, with no
  DOM and no model:
  - **Parsing rule**, from research.md R1: `s = output.trim()`. Success only if `JSON.parse(s)`
    succeeds and the value is a plain object with exactly one key `id`, whose value is a string
    matching `^[0-9]+$`.
  - **`categorize(output, error)`**, first match wins: `provider_error`, `empty`, `fence` (`s`
    starts with three backticks), `not_json`, `schema_mismatch`, `ok`.
  - **`workaroundOk(output)`** (FR-1304a): if `s` is one outer fence (three backticks, an optional
    language tag, the content, then three closing backticks), apply the parsing rule to the
    content; otherwise apply it to `s`.
  - **`decideR1(control, treatment)`** (FR-1304), returning exactly one of `material improvement`,
    `no material improvement`, or `failure not reproduced`. A parse failure is any category other
    than `ok` and `provider_error`. The rule:
    - control parse failures = 0 → `failure not reproduced`;
    - otherwise it is `material improvement` only if treatment parse failures ≤ ⌊control parse
      failures / 2⌋, treatment `fence` = 0, and every treatment provider-error name also appears in
      the control.
  - **`summarize(attempts)`**, per arm: attempts, counts per category, parseFailures,
    providerErrors by name, `fallbackCount`, latency median/min/max, and `workaroundRecovered` for the control arm.
  - **`decideGate(record)`**, implementing gates 1 to 5 of `contracts/evidence-and-decision.md`:
    - 1 `BLOCKED`, 2 not reproduced, 3 FR-1304 not met, 4 workaround sufficient → NO_CHANGE;
    - 5 every provider `C` or `D` → NO_CHANGE;
    - otherwise return `REQUIRES_REVIEW` (gates 6–8 are a human decision in T009).
- [X] T003 Create `experiments/structured-output/standin.mjs` (DETERMINISTIC_STAND_IN;
  `node:assert/strict`). It imports `./rules.js` and asserts:
  - each category, including a fenced ```` ```json ```` output, a bare-fence output, `{"id":123}`
    (`schema_mismatch`), an extra key (`schema_mismatch`), whitespace-only input (`empty`), and a
    rejected call;
  - `workaroundOk` true for a fenced valid object and false for a fenced invalid one;
  - `decideR1` for all three results, including the boundary where treatment failures equal ⌊c/2⌋;
  - every `decideGate` branch.

  Print `stand-in rules: ok`. Run it (quickstart V1).

---

## Phase 3: User Story 1 — Establish whether the native constraint fixes the failure (P1)

**Goal**: a raw, reproducible R1 record from real Chrome.

**Independent test**: the saved JSON has 30 measured attempts per arm, and `summarize`/`decideR1`
recomputed from `attempts[]` match the page's own summary (quickstart V4).

- [X] T004 [P] [US1] Create `experiments/structured-output/index.html`:
  - title "AkariSP structured output — real Prompt API";
  - a note that it refuses unless `LanguageModel.availability() === "available"` (so no download);
  - the availability display, **Run** and **Copy JSON** buttons, and `<pre id="log">` and
    `<pre id="json">`;
  - loads `./harness.js` as a module.

  Follow `experiments/prompt-api-concurrency/index.html`.
- [X] T005 [US1] Create `experiments/structured-output/harness.js`. It does not import AkariSP
  (FR-1301) and imports `./rules.js`. Constants are copied verbatim from research.md R1: system
  prompt, the 5 inputs, the prompt template, the schema, and `PARSING_RULE_VERSION = 1`.

  On **Run**:
  1. Re-check availability and refuse unless `available`.
  2. `base = await LanguageModel.create({ initialPrompts: [system] })`.
  3. For each attempt: `clone()` → `prompt(text, { signal: AbortSignal.timeout(60000),
     ...(treatment ? { responseConstraint: SCHEMA } : {}) })` → `destroy()`, in `try/finally`.
     Record the Attempt fields from data-model.md (`phase`, `arm`, `round`, `index`, `input`, raw
     `output`, `category`, `error {name,message}`, `idCorrect`, `workaroundOk`, `fallbackNeeded`, `latencyMs` around
     the call only).
  4. Run 3 warmup attempts per arm, then 30 measured per arm, interleaved ABBA per pair of rounds.
     Inputs cycle in order, and both arms see the same input in the same round.
  5. **Creation-scope check**: 10 attempts on a second base created with
     `{ initialPrompts: [system], responseConstraint: SCHEMA }`, prompted without a constraint.
  6. **Streaming check**: 5 attempts of `promptStreaming(text, { signal, responseConstraint: SCHEMA })`
     with chunks joined.
  7. Destroy both bases.
  8. Output `{ environment, protocol, attempts, summary: { control, treatment, creationScope,
     streaming }, r1: decideR1(...) }`.
     - `environment`: `userAgent`, `userAgentData` high-entropy `fullVersionList`, `platform`,
       `platformVersion`, `hardwareConcurrency`, `deviceMemory` (Constitution III), availability, and ISO
       date.
     - `protocol`: every constant plus the order description.

  Log one line per attempt. Never drop an attempt; a page-level exception is recorded as
  `aborted` in the output.
- [X] T006 [US1] Smoke-test the harness in the built-in browser, which is not evidence. Serve the
  repo root and load the page with a fake `LanguageModel`:
  - `availability → 'available'`;
  - a fake `clone().prompt` that returns a fenced output for the control and a bare object for the
    treatment.

  Confirm the output has 66 warmup and measured attempts plus 10 + 5 supplementary attempts, that
  its summaries match `rules.js`, and that `r1 === 'material improvement'` for this fake. Do not save
  this output.
- [X] T007 [US1] **Maintainer, real Chrome.** Open
  `http://localhost:8080/experiments/structured-output/index.html` with the model available, press
  **Run**, then **Copy JSON**.
  - Save it unchanged as `experiments/structured-output/results/chrome-<major>-<run-date>-run-01.json`
    (read from the clipboard and diffed against what was pasted).
  - Recompute `summarize` and `decideR1` from `attempts[]` and confirm they match (quickstart V4).
  - If no Chrome with the model available exists, record `r1 = BLOCKED` in research.md and skip to
    T008.

**Checkpoint**: R1 is answered by raw evidence, or it is BLOCKED.

---

## Phase 4: User Story 2 — Decide the narrowest boundary, or none (P1)

**Goal**: exactly one outcome with its gate and evidence.

**Independent test**: a reviewer reading only research.md and the experiment README can reproduce
the outcome from the gates in `contracts/evidence-and-decision.md`.

- [X] T008 [US2] Fill "Decision record" in `specs/013-task-scoped-provider-options/research.md`:
  - R1 result and the per-arm counts;
  - `workaroundRecovered` and whether the workaround is sufficient (FR-1304a);
  - creation-scope and streaming observations (OBS, exploratory);
  - final R3 class per provider with reasons, updating the R3 table only where the observations
    change it.

  Label every statement CONTRACT, IMPL, OBS, or HYP.
- [X] T009 [US2] Apply the gates in order: `decideGate` for gates 1–5, then human judgment for
  gates 6–8 against R4–R7. Record in research.md:
  - `outcome`, the deciding gate number, and the FR-1310 clause;
  - for PUBLIC_MINIMAL_EXTENSION only, the provider-neutral capability statement, the meaning for
    each other provider (FR-1313), and draft ownership semantics (FR-1330). The API shape stays
    unselected.
- [X] T010 [P] [US2] Create `experiments/structured-output/README.md` with these sections:
  - Question;
  - Evidence classes: each finding carries both its source class (SOURCE /
    PLATFORM_SPECIFICATION / REAL_BROWSER / DETERMINISTIC_STAND_IN) and its FR-1342 label
    (documented contract / implementation behavior / experimental observation / hypothesis);
  - Protocol (link to research.md R1 and restate the parsing and workaround rules);
  - Results table (per arm: attempts, `ok`, `fence`, `not_json`, `schema_mismatch`, `empty`,
    provider errors, fallback count, latency median);
  - Supplementary checks;
  - Decision (outcome + gate);
  - What it does not prove (one browser, one device, one workload, no conformance guarantee);
  - Revisit conditions;
  - Reproduce.

  **If the outcome is INTERNAL_ONLY or PUBLIC_MINIMAL_EXTENSION**: stop here, report, and wait for a
  plan amendment. Do not touch `src/`.

---

## Phase 5: User Story 3 — Existing callers and lifecycle unaffected (P2, conditional)

Not generated now. It applies only after an approved plan amendment (plan.md Summary) and must then
cover FR-1320 items 1–10, FR-1321, SC-1303, SC-1304 and SC-1305. With NO_CHANGE this phase is
empty by design (SC-1306).

---

## Phase 6: Polish & audit

- [X] T011 Final audit (quickstart V2, V6), recorded in research.md "Implementation evidence":
  - `npm test` 146/146, `npx tsc --noEmit`, and `npm run test:browser` 21/21, unchanged;
  - `git diff main --stat -- src/ api/ test/ README.md package.json` is empty;
  - the `api/akarisp.api.txt` hash equals T001;
  - `node experiments/structured-output/standin.mjs` passes.

  Do not run `test:frameworks` or `test:registry`.

---

## Dependencies & Execution Order

```text
T001 → T002 → T003 → (T004 ∥ T005) → T006 → T007 → T008 → T009 → T010 → T011
```

- T004 and T005 touch different files. T005 needs T002.
- T007 needs the maintainer's Chrome. Everything before it can be done and verified offline or in
  the built-in browser.
- T008 and T009 need T007 (or BLOCKED). T010 needs T009's outcome.

## Parallel Example

```text
T004 index.html   ∥   T005 harness.js      (after T003)
T010 experiment README can be drafted alongside T008/T009 and finalized after T009
```

## Implementation Strategy

- **MVP**: T001–T007. The R1 question is answered with raw evidence.
- **Complete for NO_CHANGE**: T008–T011, with 0 library changes.
- **INTERNAL_ONLY / PUBLIC_MINIMAL_EXTENSION**: stop after T010, amend the plan, then regenerate
  tasks for US3.

## Traceability

| Requirement | Tasks |
|---|---|
| FR-1301, FR-1302, FR-1303 | T005, T007 |
| FR-1304, FR-1304a | T002, T003, T008 |
| FR-1305 (R2), FR-1309a (R7) | T005 (supplementary checks), T008 |
| FR-1306 (R3), FR-1313 | T008, T009 |
| FR-1307 (R4), FR-1308 (R5), FR-1309 (R6) | T009 (against research.md R4–R6) |
| FR-1310, FR-1311, FR-1312 | T009, T010 |
| FR-1320–FR-1322, FR-1330 | Phase 5 (conditional); T009 drafts ownership for an extension only |
| FR-1340–FR-1342 | Scope boundary, T008 labels, T011 |
| SC-1301 | T003, T007, T008 |
| SC-1302 | T009 |
| SC-1303–SC-1305 | T011 (unchanged suites); Phase 5 if extended |
| SC-1306 | T011 |
