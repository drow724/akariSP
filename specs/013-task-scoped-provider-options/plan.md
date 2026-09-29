# Implementation Plan: Task-Scoped Provider Options Boundary Validation

**Branch**: `013-task-scoped-provider-options` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/013-task-scoped-provider-options/spec.md`

## Summary

This feature is research-first, and its deliverable is a decision.

**Stage 1 — evidence.** A research-only harness in `experiments/structured-output/` runs the R1
comparison in real Chrome directly on native task sessions. It compares prompt-only formatting
(control) with the native structured-output constraint (treatment), 30 measured attempts per arm.
It also runs two small supplementary checks: a creation-scope check (R2/R3) and a streaming check
(R7).

**Stage 2 — decision.** The results, together with the static findings already made here
(research.md R2–R7), are recorded in `research.md` as exactly one outcome (FR-1310):

| Outcome | What follows |
|---|---|
| NO_CHANGE | Commit the evidence. The feature ends. `src/` and the API snapshot are unchanged |
| INTERNAL_ONLY | A plan amendment names the internal change. The public API is unchanged |
| PUBLIC_MINIMAL_EXTENSION | A **plan amendment** is required before any `src/` change. It chooses the boundary shape from the R4 candidates, writes the public contract and ownership semantics (FR-1330), and lists the invariant tests (FR-1320). This plan does not pre-select a shape |

| Area (Stage 1 and 2) | Change |
|---|---|
| Production `src/` | 0 |
| Public API and `api/akarisp.api.txt` | 0 |
| Tests | 0 |
| README | 0 |
| Runtime dependencies | 0 |
| Research files | `experiments/structured-output/` (harness, stand-in check, raw results, README) |

## Technical Context

**Language/Version**: TypeScript 5.9 (library, unchanged); plain ES modules for the harness.
Node ≥ 22.18 for the stand-in check.

**Primary Dependencies**: none new. The harness uses the browser's `LanguageModel` global
directly and does not import AkariSP (FR-1301).

**Storage**: raw results as JSON files in `experiments/structured-output/results/`, saved
unchanged.

**Testing**:
- `npm test` and `npm run test:browser` as proportional checks that nothing in the library changed.
- `node experiments/structured-output/standin.mjs` checks only the parsing, categorization,
  workaround and decision-rule code, with assert-based fixtures.

**Target Platform**: desktop Chrome with the Prompt API model already `available`. The page
refuses any other state, so it never starts a download.

**Project Type**: single-package library; research harness under `experiments/`.

**Performance Goals**: N/A. Latency is recorded per attempt for description only.

**Constraints**:
- Clarifications: 30 measured attempts per arm; the FR-1304 rule; the FR-1304a workaround rule;
  FR-1313 (one provider is enough, but the boundary must be provider-neutral).
- The parsing rule, workaround rule, constraint shape and prompts are fixed in research.md before
  measurement.
- No model download. No change to AkariSP to run the treatment.

**Scale/Scope**:
- One harness page (about 150 lines) and one calculation module with its stand-in check.
- 3 warmup and 30 measured attempts per arm; 10 creation-scope attempts; 5 streaming attempts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I Small Core | PASS | Stages 1–2 change no core code. Any later extension must keep the core unaware of provider vocabulary (SC-1302) |
| II Browser Native First, IX Native Features | PASS | The treatment is the platform's own constraint mechanism. No parser or fence stripping in AkariSP (FR-1340) |
| III Benchmark Driven | PASS | Real-browser raw attempts, environment metadata, a fixed decision rule, and a reproducible harness |
| IV Minimal Overhead | PASS | No runtime change |
| V Explicit Lifecycle | PASS | Unchanged. FR-1320 applies to any later change |
| VI Context Safety | PASS | Treatment and control each run on a fresh clone per attempt. FR-1320 item 10 guards any later change |
| VII Framework Agnostic, X Scope Discipline | PASS | No adapter, agent, or tool integration (FR-1340) |
| VIII Provider Extensibility Without Premature Abstraction | PASS, gated | R4 compares shapes without selecting one. FR-1313 allows an extension justified by one provider only if it stays provider-neutral |
| XI Reliability Over Feature Count | PASS | The known lifecycle contract is untouched |
| XII Public API Stability | PASS | Snapshot unchanged unless the outcome is PUBLIC_MINIMAL_EXTENSION, which requires a plan amendment |

Post-design re-check: unchanged, all PASS. No complexity-tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/013-task-scoped-provider-options/
├── plan.md              # This file
├── research.md          # Static findings R2–R7, fixed R1 protocol, decision record (filled after the run)
├── data-model.md        # Attempt, arm summary, boundary decision
├── quickstart.md        # How to run the stand-in check and the real-browser harness
├── contracts/
│   └── evidence-and-decision.md   # Result record format and the FR-1310 decision gates
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
experiments/structured-output/
├── README.md            # Question, protocol, results, decision (after the run)
├── index.html           # Real-browser page (refuses unless availability is "available")
├── harness.js           # Runs the arms directly on native clones
├── rules.js             # Parsing rule, failure categories, workaround rule, FR-1304 decision
├── standin.mjs          # assert-based check of rules.js (DETERMINISTIC_STAND_IN)
└── results/             # Raw JSON, saved unchanged
```

`src/`, `test/`, `api/`, and `README.md` are unchanged in Stages 1 and 2.

**Structure Decision**: follow `experiments/prompt-api-concurrency/` (page + shared calculation
module + stand-in check + raw results). The harness does not import `dist/`, because the treatment
cannot pass through AkariSP today (FR-1301).

## Complexity Tracking

None.
