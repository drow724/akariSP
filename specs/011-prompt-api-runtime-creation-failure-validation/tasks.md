---

description: "Task list for 011-prompt-api-runtime-creation-failure-validation"
---

# Tasks: Prompt API Runtime Creation Failure Validation

**Input**: Design documents from `/specs/011-prompt-api-runtime-creation-failure-validation/`

**Prerequisites**: spec.md (clarified), plan.md, research.md (R1–R6),
contracts/creation-failure-contract.md, quickstart.md (V1–V6); checklists `requirements.md`
16/16 and `contract.md` 22/22.

**Tests**: One focused regression test (FR-1109 gap, research R2). Everything else is verified by
the existing tests mapped in research R1. **Do not duplicate them.**

**Scope boundary**:
- 0 `src/` changes, 0 public API changes, 0 runtime dependency changes. This is the expected,
  complete outcome (FR-1112).
- If any task seems to require changing the established contract (missing-global
  `ReferenceError`, provider-error passthrough, `TaskError` scope, public error types,
  capability or environment API), stop. Record it as a separately scoped future feature; do not
  implement it.
- Object identity is **not** an acceptance condition (clarification Q1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: spec user stories:
  - US1: safe package consumption
  - US2: predictable runtime creation failure
  - US3: supported lifecycle unchanged

---

## Phase 1: Setup

- [X] T001 Record the baseline in a new "Implementation evidence" section at the end of
  `specs/011-prompt-api-runtime-creation-failure-validation/research.md`:
  - `npm test` (expect 145/145);
  - `npx tsc --noEmit`;
  - `npm run test:browser` (expect 21/21);
  - `npm pack --dry-run --json` file count (expect 13).

  No code changes.

---

## Phase 2: Foundational

No foundational work. Every story reuses the existing test suites and helpers.

---

## Phase 3: User Story 1 — Safe package consumption (P1)

**Goal**: importing either entry point with no Prompt API global reads it 0 times and creates
nothing.

**Independent test**: the existing tests in research R1 (FR-1101 row) pass.

- [X] T002 [US1] Confirm FR-1101 by running the existing tests; no new test:
  - `test/browser.test.ts` "importing the entry reads no global";
  - `test/boundary.test.ts` "importing the core reads no LanguageModel global";
  - `test/boundary.test.ts` "core source has no browser globals and no browser import";
  - `test/boundary.test.ts` "the WebLLM module imports only the core";
  - `test/package.test.ts` "public entry points export exactly their names".

  Record the result in `research.md`. It is implicit coverage for the `akarisp/webllm` entry
  (structural tests plus the consumer import), as noted in checklist CHK017.

---

## Phase 4: User Story 2 — Predictable runtime creation failure (P1)

**Goal**: every creation failure is reported by rejection, carries the environment's or
provider's own error untranslated, is not a `TaskError`, and leaves 0 resources.

**Independent test**: `node --test test/browser.test.ts test/runtime.test.ts` passes, including
the new public-entry test.

- [X] T003 [US2] Add one test to `test/browser.test.ts`, reusing `installGlobal`. It covers
  FR-1105, FR-1107, and FR-1109 (research R2), in a style that matches the neighbouring tests.
  - **Name**: "create rejection reaches the public entry without translation".
  - **Setup**: `installGlobal({ async create() { throw new DOMException('no model', 'NotAllowedError'); } })`,
    then `const { createRuntime, TaskError } = await entry();`.
  - **Assert**: `assert.rejects(createRuntime(), (e) => e instanceof DOMException && e.name === 'NotAllowedError' && e.message === 'no model' && !(e instanceof TaskError))`.
  - **Do NOT assert `e === error`.** Object identity is regression evidence covered by the
    existing core test (`test/runtime.test.ts` "create rejection propagates unchanged"), not an
    acceptance condition.
  - Do not add a helper or a file.
- [X] T004 [US2] Run `npm test` (expect 146/146).
  - Record in `research.md` that FR-1102 to FR-1107 are covered by the new T003 test plus the
    existing tests from research R1:
    - "option validation fails before the global is read";
    - "invalid limit / queueCapacity reject TypeError before create";
    - "no global: creating a runtime rejects with ReferenceError";
    - "create rejection propagates unchanged";
    - "templates: partial creation rolls back created bases and rethrows the original error";
    - "templates: rollback includes the default base and continues past destroy failures".
  - No existing assertion is changed.

---

## Phase 5: User Story 3 — Supported lifecycle unchanged (P2)

**Goal**: create → task → task cleanup → base cleanup → `closed` is unchanged (control).

**Independent test**: the existing lifecycle tests pass.

- [X] T005 [P] [US3] Confirm FR-1108 by running the existing tests; no new test:
  - `test/browser.test.ts` "the native session is used by the core as returned";
  - `test/runtime.test.ts` "run clones, prompts the clone, destroys it, never prompts the base";
  - `test/runtime.test.ts` "shutdown cancels running (AbortError), rejects queued (closed), destroys everything".

  Cite the historical real-browser evidence (Chrome 7/7 in `smoke/results/*-008.json`; the 010
  manual real-model runs) in `research.md`. Do not re-run 006 or 010.

---

## Phase 6: Documentation and evidence (US2)

- [X] T006 [US2] In `README.md`, add the planned paragraph directly after the Usage paragraph that
  begins "Each `run()` clones the base…". That paragraph wraps across two lines, so match its
  start, not the exact sentence. Add the paragraph
  (research R4) verbatim, as prose with no fenced code:

  > `createRuntime()` reports creation failures through its returned promise, and does not call
  > `LanguageModel.availability()` before creation. If the Prompt API global is missing, the
  > promise rejects with `ReferenceError: LanguageModel is not defined`. If
  > `LanguageModel.create()` rejects, the provider's error is propagated without AkariSP-specific
  > translation or conversion to `TaskError`, which is reserved for task execution. Applications
  > that need a preflight check can first test `'LanguageModel' in globalThis` and, only when the
  > global is present, use `LanguageModel.availability()`.

  Then run `npm test`. The 008 README-sample compile check must still pass on its 5 `js`
  samples.
- [X] T007 [P] [US2] Keep `experiments/prompt-api-creation/run.mjs` and
  `experiments/prompt-api-creation/results-2026-09-27.json` unchanged, to be committed with the
  feature (research R3). Do not modify the harness or add a suite for it.

---

## Phase 7: Polish & audit

- [X] T008 Final audit (quickstart V2–V4, V6), recorded in `research.md`:
  - `npx tsc --noEmit` and `npm run build` pass;
  - `npm run test:browser` passes 21/21;
  - `git diff main --stat -- src/ api/` is empty;
  - `package.json` `dependencies` is absent;
  - `npm pack --dry-run` lists 13 files;
  - the README paragraph matches research R4: safe preflight order, no identity promise, no
    real-browser unavailable-error claim, no AkariSP capability API;
  - the deferred download observation (research R6) is still only recorded.

  Do not run `test:frameworks` or `test:registry` (quickstart: not affected).

---

## Dependencies & Execution Order

```text
T001 → T002 → T003 → T004 → T005 ∥ → T006 → T007 ∥ → T008
```

- T005 (runs existing tests only) and T007 (keeps files) can run in parallel with their
  neighbours.
- T003 and T006 touch different files, but T004 must see T003 before T006 changes the README
  that the package test compiles.

## Implementation Strategy

- **MVP**: T001–T004, the public-path regression gap closed.
- **Complete**: T005–T008. The control is confirmed, the README is clarified, the evidence is
  kept, and the audit is done.

## Traceability

| Requirement | Tasks |
|---|---|
| FR-1101, SC-1101 | T002 (Node), T007 (browser evidence in the retained research results) |
| FR-1102, SC-1104 | T004 (existing tests) |
| FR-1103, FR-1104, SC-1102 | T004 (existing tests) |
| FR-1105, FR-1107, SC-1103 | T003, T004 |
| FR-1106 | T004 (existing tests) |
| FR-1108, SC-1105 | T005 |
| FR-1109 | T003 (the only gap), T002, T004, T005 |
| FR-1110 | T007 (research artifacts keep the real-browser vs stand-in labels), T008 |
| FR-1111, SC-1107 | T006, T008 |
| FR-1112, SC-1106 | T008 |
