# Research: Prompt API Runtime Creation Failure Validation

Pre-feature research: the four experiments summarized in [spec.md](spec.md), "Evidence". This
document maps every requirement to existing evidence and records the planning decisions.

## R1. Requirement → evidence map

Where a test is named `file:line`, the line is the declaration on branch
`011-prompt-api-runtime-creation-failure-validation` (from `main` `d32147d`).

| Req | Existing evidence (automated) | Kind | Covered? |
|---|---|---|---|
| **FR-1101** import boundary | `test/browser.test.ts:24` "importing the entry reads no global": a counting getter on `LanguageModel` sees 0 reads. `test/boundary.test.ts:7` "importing the core reads no LanguageModel global". `test/boundary.test.ts:21`: no browser globals in the core source. `test/boundary.test.ts:58`: the WebLLM module imports only the core. `test/package.test.ts:54`: both public entries import from the packed tarball in a consumer without the global | existing regression (Node) + pre-feature research (Chromium, published package) | **Yes**. 0 reads means no `create()` and no `availability()`, because both live on the global |
| **FR-1102** validation first | `test/runtime.test.ts:204` "invalid limit / queueCapacity reject TypeError before create" (`fake.creates === 0`). `test/browser.test.ts:30` "option validation fails before the global is read" (0 reads) | existing regression | **Yes** |
| **FR-1103** rejection, never a synchronous throw | `test/browser.test.ts:39` and `test/runtime.test.ts:215` call `assert.rejects(createRuntime())`. A synchronous throw would escape while evaluating the argument and fail the test | existing regression (implicit) | **Yes** |
| **FR-1104** absent → `ReferenceError` | `test/browser.test.ts:39` "no global: creating a runtime rejects with ReferenceError", through the public entry | existing regression + pre-feature research (Node and Chromium: message `LanguageModel is not defined`) | **Yes** |
| **FR-1105** provider rejection passed through | `test/runtime.test.ts:215` "create rejection propagates unchanged" (`e === error`). This is **core level**: a fake provider through `createCoreRuntime` | existing regression (core); pre-feature stand-in (published package) | **Partly**. No test drives a rejecting `LanguageModel.create()` through the **public browser entry** (FR-1109: "exercises the public path") |
| **FR-1106** no resources left | Absent: nothing is created (`test/browser.test.ts:39`; research: 0 calls). Partial: `test/runtime.test.ts:1579` "templates: partial creation rolls back created bases and rethrows the original error" (`destroys 2`, `live 0`). `test/runtime.test.ts:1587` "rollback includes the default base and continues past destroy failures" | existing regression | **Yes** |
| **FR-1107** not a `TaskError` | `test/runtime.test.ts:215`, `:1579`, and `:1587` assert the provider's own error, so it cannot be a `TaskError`. `test/browser.test.ts:39` asserts `ReferenceError` | existing regression (implicit) | **Yes**. The new public-path test states it explicitly |
| **FR-1108** supported lifecycle | `test/browser.test.ts:56` "the native session is used by the core as returned" (public entry `run`). `test/runtime.test.ts:232` "run clones, prompts the clone, destroys it". `test/runtime.test.ts:666` "shutdown … destroys everything". Real browser: Chrome 7/7 (`smoke/results/*-008.json`), and 010 manual run/stream with the real model | existing regression + historical real-browser evidence | **Yes** |
| **FR-1109** reproducible public-path evidence | All of the above, plus the pre-feature script | — | **Yes after R2** |
| **FR-1110** real browser vs stand-in | Chromium (real, API absent) vs stand-ins (unavailable, available), labelled in `experiments/prompt-api-creation/results-*.json` and in spec.md | pre-feature research | **Yes**; kept in R3 |
| **FR-1111** README | README documents only the server-side missing-global case ("Using with frameworks") | — | **No**, see R4 |
| **FR-1112** diff boundary | — | — | Checked at the end (quickstart V4) |

SC-1101 to SC-1107 follow the same rows: SC-1101 from FR-1101, SC-1102 from FR-1103 and FR-1104,
SC-1103 from FR-1105 to FR-1107, SC-1104 from FR-1102, SC-1105 from FR-1108, SC-1106 from
FR-1112, and SC-1107 from FR-1111.

## R2. The only coverage gap: provider rejection through the public entry

- **Decision**: add **one** test to the existing `test/browser.test.ts`, reusing its
  `installGlobal` helper. It checks that a `LanguageModel.create()` rejection reaches the public
  `createRuntime()` without AkariSP-specific translation, wrapping, or `TaskError` conversion.
  1. Install a global whose `create()` rejects with a `DOMException`.
  2. The rejection is that `DOMException`, with the provider's name and message. It is not a
     `TaskError` and not any other AkariSP error.

  **Object identity is not an acceptance condition** of this test (clarification Q1):
  - The new test asserts no `e === error`.
  - Identity stays protected as implementation regression evidence by the existing core test
    (`runtime.test.ts:215`).

  The test is about 5 lines. There is no new helper, file, or framework.
- **Rationale**: the core-level test (`runtime.test.ts:215`) proves the core does not translate.
  Only a public-entry test proves the browser adapter does not either, which is what FR-1105
  and FR-1109 ask for. Every other requirement is already covered.
- **Alternatives**:
  - A new test file: rejected as unnecessary.
  - Promoting the research script into the suite: rejected, because it needs the network and a
    browser, and `npm test` is offline.

## R3. Disposition of the research files

- **Decision: keep both, unchanged, as committed research evidence** (option A):
  `experiments/prompt-api-creation/run.mjs` and `experiments/prompt-api-creation/results-2026-09-27.json`.
- **Rationale**:
  - **Precedent**: `experiments/webllm/` (a harness plus results) was committed in 007 as the
    evidence behind a spec. 011's spec cites these files the same way.
  - **Unique value**: they are the only evidence that exercises the **published package** in a
    **real browser** without the Prompt API, and the only record of which results came from
    stand-ins (FR-1110). The unit tests cover the same behaviors in Node against the source.
  - **Maintenance cost**: about 0. The files are not part of any test run, add no dependency,
    and are outside the packed files.
  - **Duplication**: partial, with Node unit tests. Deleting the files would lose the
    real-browser and published-package evidence and leave the spec citation dangling.
- **Alternatives**:
  - (B) Integrating into the suites: rejected, because it needs the network and a browser.
  - (C) Results only: rejected, because they could not be reproduced.
  - (D) Deleting both: rejected, because the unique evidence and the spec citation would be lost.

## R4. README clarification (FR-1111)

- **Decision**: one short paragraph in the root README's Usage section, directly after the
  sentence "Each `run()` clones the base … its slot released.":

  > `createRuntime()` reports creation failures through its returned promise, and does not call
  > `LanguageModel.availability()` before creation. If the Prompt API global is missing, the
  > promise rejects with `ReferenceError: LanguageModel is not defined`. If
  > `LanguageModel.create()` rejects, the provider's error is propagated without AkariSP-specific
  > translation or conversion to `TaskError`, which is reserved for task execution. Applications
  > that need a preflight check can first test `'LanguageModel' in globalThis` and, only when the
  > global is present, use `LanguageModel.availability()`.

- **Rationale**:
  - It covers exactly the FR-1111 points, including the safe preflight order, and says nothing
    that was not observed.
  - It does not promise object identity ("the provider's error … without … translation"), does
    not name any real-browser error for the unavailable state, and adds no AkariSP API.
  - It is prose, not a fenced code block, so the 008 README-sample compile check is unaffected.
- **Alternatives**: a new "Errors" section. Rejected as larger than the gap.

## R5. Production source, public API, dependencies

- **Decision**: 0 / 0 / 0. Every FR is met by the existing behavior, which is verified by
  existing tests plus R2, with the README from R4.
- **Snapshot**: `api/akarisp.api.txt` does not change. The package test compares it on every
  `npm test`, so a change there would flag a scope violation.
- **Contract risk**: no planned item touches the missing-global `ReferenceError`, provider-error
  passthrough, or `TaskError` scope. R2 only asserts the existing behavior, and R4 only
  describes it.

## R6. Deferred observation (not investigated)

AkariSP calls `LanguageModel.create()` without first calling `LanguageModel.availability()`. The
006 harness comment (`smoke/streaming.js:378`) notes that `create()`, unlike `availability()`, may
start a model download. Whether `createRuntime()` in a downloadable or downloading state causes
download side effects is **not validated** and is outside 011. Download initiation, consent,
progress, and cancellation are not planned.

This project records such findings in feature research (as in 010 "Observation, not proposed"),
so this entry is the record.

## Implementation evidence

### Baseline (T001)

`npm test` 145/145, `npx tsc --noEmit` pass, `npm run test:browser` 21/21, `npm pack --dry-run` 13
files.

### Import boundary (T002, FR-1101 / SC-1101)

**Result**: the existing tests pass, and no test was added.
- `test/browser.test.ts` "importing the entry reads no global": ✔
- `test/boundary.test.ts` "importing the core reads no LanguageModel global": ✔
- `test/boundary.test.ts` "core source has no browser globals and no browser import": ✔
- `test/boundary.test.ts` "the WebLLM module imports only the core": ✔
- `test/package.test.ts` "public entry points export exactly their names": ✔

**Coverage notes**:
- The `akarisp/webllm` entry is covered implicitly: the structural boundary tests plus a
  consumer import, with no read count (checklist CHK017).
- The browser half of SC-1101 comes from the retained research results (Chromium 153, published
  package, 0 reads).

### Public-entry provider rejection (T003, T004; FR-1105, FR-1107, FR-1109 / SC-1103)

**New test**: `test/browser.test.ts` "create rejection reaches the public entry without
translation".
- A global whose `create()` rejects with `DOMException('no model', 'NotAllowedError')` makes the
  public `createRuntime()` reject with a `DOMException` of the same name and message, which is
  not a `TaskError`.
- It asserts **no object identity**; identity stays with the existing core test (clarification
  Q1).

**Mutation check**: temporarily making the browser adapter wrap the error
(`new Error('wrapped', { cause })`) fails the new test. The source was then restored
(`git diff src/` is empty).

**Suite result**: `npm test` 146/146 (145 + 1). No existing assertion changed. FR-1102 to FR-1107
stay covered by the existing tests named in R1.

### Supported lifecycle (T005, FR-1108 / SC-1105)

**Result**: the existing tests pass, and no test was added.
- "the native session is used by the core as returned": ✔
- "run clones, prompts the clone, destroys it, never prompts the base": ✔
- "shutdown cancels running (AbortError), rejects queued (closed), destroys everything": ✔

**Real-browser evidence** (historical, not re-run): Chrome 7/7 (`smoke/results/*-008.json`), and
the real-model run and stream in the 010 manual runs.

### README (T006, FR-1111 / SC-1107)

The research R4 paragraph was added verbatim after the Usage paragraph that begins
"Each `run()` clones the base…". It states the safe preflight order (global first, then
`availability()` only when present). It makes no identity promise, no real-browser claim about
the unavailable state, and adds no AkariSP API.

`npm test` stays 146/146, and the README-sample compile check still passes on its 5 `js` samples.

### Research artifacts (T007, FR-1110)

`experiments/prompt-api-creation/run.mjs` and `results-2026-09-27.json` are kept unchanged, to be
committed with the feature (R3).

### Final audit (T008, FR-1112 / SC-1106)

| Check | Result |
|---|---|
| `npx tsc --noEmit` / `npm run build` | pass / pass |
| `npm run test:browser` | 21/21 |
| `git diff main -- src/ api/` | empty: 0 production changes, snapshot unchanged |
| `package.json` `dependencies` | none |
| `npm pack --dry-run` | 13 files |
| Diff vs `main` | `README.md` +8 lines, `test/browser.test.ts` +9 lines, research files, specs |
| Contract changes | none (missing-global `ReferenceError`, provider-error passthrough, `TaskError` scope untouched) |
| Deferred download observation (R6) | recorded only |

Not run, per quickstart: `test:frameworks` and `test:registry`, because no runtime code or package
contents changed apart from the README.
