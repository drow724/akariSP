# Implementation Plan: Prompt API Runtime Creation Failure Validation

**Branch**: `011-prompt-api-runtime-creation-failure-validation` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-prompt-api-runtime-creation-failure-validation/spec.md`

## Summary

The existing Prompt API runtime-creation failure contract (001, 004, 005) already satisfies every
requirement. It is covered by existing tests, with one gap: provider rejection through the
**public browser entry**. The plan closes that gap with one test in `test/browser.test.ts`, adds
one README paragraph, and commits the pre-feature research files as evidence.

| Change | Where | Research |
|---|---|---|
| +1 test: a `LanguageModel.create()` rejection reaches the public `createRuntime()` without AkariSP translation, wrapping, or `TaskError` conversion (identity not asserted) | `test/browser.test.ts` | R2 |
| +1 paragraph: rejection-only reporting, no `availability()` call, missing-global error, passthrough, platform preflight in safe order (global first, then availability) | `README.md` (Usage) | R4 |
| Commit the research harness and results as evidence | `experiments/prompt-api-creation/` | R3 |

| Area | Change |
|---|---|
| Production `src/` | 0 |
| Public API and `api/akarisp.api.txt` | 0 |
| Runtime dependencies | 0 |

## Technical Context

**Language/Version**: TypeScript 5.9, Node ≥ 22.18 (tests). Unchanged.

**Primary Dependencies**: none new.

**Storage**: N/A

**Testing**: `node:test` (`npm test`, offline). The existing Playwright `test:browser` is run as a
proportional check. The research script is optional and not part of any suite.

**Target Platform**: browsers (Prompt API). Unchanged.

**Project Type**: single-package library.

**Performance Goals**: N/A.

**Constraints**:
- Do not change the established contract (FR-1104, FR-1105, FR-1107; clarification Q2).
- Do not promise object identity (clarification Q1).
- No capability or availability API.

**Scale/Scope**:
- 1 test (~5 lines);
- 1 README paragraph (~6 lines);
- 2 research files committed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I Small Core, IV Minimal Overhead | PASS | No code change |
| II Browser Native First, IX Native Features | PASS | Preflight is left to the platform's own Prompt API checks |
| V Explicit Lifecycle, XI Reliability | PASS | The creation failure leaves 0 resources; this is already tested and re-verified |
| VIII Provider Extensibility | PASS | `LanguageModel` stays in the browser adapter; the core is untouched |
| XII Public API Stability | PASS | 0 public changes; the snapshot is unchanged |
| III Benchmark Driven, VI, VII, X | N/A / PASS | Not affected |

Post-design re-check: PASS. There is no Complexity Tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/011-prompt-api-runtime-creation-failure-validation/
├── spec.md, checklists/requirements.md
├── plan.md
├── research.md          # R1 evidence map, R2 gap, R3 artifacts, R4 README, R5 diffs, R6 deferred
├── data-model.md        # creation failure record
├── contracts/creation-failure-contract.md   # existing contract, restated
├── quickstart.md        # V1–V6
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
test/browser.test.ts                      # +1 test (R2)
README.md                                 # +1 paragraph (R4)
experiments/prompt-api-creation/run.mjs   # committed as-is (R3)
experiments/prompt-api-creation/results-2026-09-27.json
```

**Structure Decision**: no new directories or modules; the change fits the existing test file and
README.

## Implementation order (for /speckit-tasks)

1. Record the baseline: `npm test` (145), `tsc`, `test:browser` (21).
2. Add the R2 test, then run `npm test` (146).
3. Add the R4 README paragraph, then run `npm test` (the README compile check is unchanged).
4. Commit the research files (R3).
5. Verify the diffs (quickstart V4): `src/`, `api/`, and dependencies at 0; `npm pack` at 13
   files.

## Complexity Tracking

None.
