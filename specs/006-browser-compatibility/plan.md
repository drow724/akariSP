# Implementation Plan: Browser Compatibility Validation

**Branch**: `006-browser-compatibility` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-browser-compatibility/spec.md`

## Summary

Turn the existing streaming smoke page into a capability-driven compatibility harness, in place.
The page classifies the running browser from `LanguageModel` presence and the raw
`availability()` value (never the user agent), records an import check in every browser, gates
the seven lifecycle checks (the five existing ones unchanged, plus normal run and a structural
clone-isolation check) to PASS / FAIL / BLOCKED / SKIPPED, keeps INFO as separate evidence,
computes one overall value, and renders / copies a small JSON result. The pure classification and
outcome math lives in `smoke/report.js` and gets one automated test file. A shared Playwright
spec runs the page on Chromium, Firefox, and WebKit engines (harness and import-safety evidence),
while real-model lifecycle evidence stays with real Chrome / Edge runs. **Production `src/`
changes: 0. Runtime dependencies added: 0. Dev dependency added: `@playwright/test`.**

## Technical Context

**Language/Version**: browser ES modules (harness); TypeScript 5.9 for the library (unchanged)

**Primary Dependencies**: none at runtime; dev: `typescript` (unchanged) + `@playwright/test`

**Storage**: dated JSON evidence files in `smoke/results/` (written manually)

**Testing**: three layers, none substituting for another:
1. `node:test`: 98 existing tests unchanged, plus `test/report.test.ts` for the harness logic.
2. Playwright `e2e/compatibility.spec.ts` on Chromium, Firefox, and WebKit engines.
3. Manual real-browser runs (real Chrome / Edge models; Safari / Firefox where practical).

**Target Platform**: desktop Chrome, Edge, Firefox, Safari (whatever the maintainer can run);
mobile out of scope

**Project Type**: library + manual harness

**Performance Goals**: none; no performance claim or benchmark

**Constraints**: no UA routing, no auto download, no telemetry, no fake model in the page
(automated stand-ins only for non-available states), WebKit ≠ Safari, no production change
without a reproduced defect

**Scale/Scope**: `smoke/streaming.js` ≈ +120 lines (harness only; 5 check bodies unchanged),
`smoke/report.js` ≈ 40, `smoke/streaming.html` ≈ +10, `test/report.test.ts` ≈ 60,
`e2e/compatibility.spec.ts` ≈ 70, `playwright.config.ts` ≈ 15, docs

**Baseline (recorded 2026-09-27, `main` = `1c6f302`, PR #5 merged)**: 98/98 tests, `tsc` clean,
build OK, runtime dependencies 0, real Chrome streaming smoke 5/5 (after 005).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Small Core | ✅ | Core untouched |
| II. Browser Native First | ✅ | Uses the browser's own `availability()`; no polyfill or fallback |
| III. Benchmark Driven | ✅ | No performance claim; latency never asserted |
| IV. Minimal Overhead | ✅ | No production code |
| V. Explicit Lifecycle | ✅ | Every check still shuts down every runtime it creates |
| VI. Context Safety | ✅ | Isolation stays proven by unit tests; real-browser probe is evidence only |
| VII. Framework Agnostic | ✅ | Plain page |
| VIII. No Premature Provider Abstraction | ✅ | No second provider, no capability API |
| IX. Native Features Before Reinvention | ✅ | `isSecureContext`, `availability()`, clipboard API, `crypto.getRandomValues`; one dev tool (Playwright) for what no platform feature does: driving 3 engines |
| X. Scope Discipline | ✅ | Exclusions below |
| XI. Reliability Over Feature Count | ✅ | Environment problems are BLOCKED/SKIPPED, not hidden and not blamed on AkariSP |
| XII. Public API Stability | ✅ | No public API change |

**Post-design re-check**: ✅ All gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/006-browser-compatibility/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/result-json.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
smoke/
├── streaming.html       # + capability rows, overall, JSON block, Re-check / Copy JSON buttons
├── streaming.js         # dynamic import, classification, gating, outcomes, 2 new checks, JSON
├── report.js            # NEW: pure classify / gate / outcomeOf / overall
├── results/             # NEW: dated evidence JSON (manual runs actually performed)
└── README.md            # compatibility section, layers, outcome rules, matrix, Safari CI recipe
test/
└── report.test.ts       # NEW: harness logic (98 existing tests untouched)
e2e/
└── compatibility.spec.ts # NEW: one shared Playwright spec (native capability + stand-in states)
playwright.config.ts     # NEW: chromium / firefox / webkit projects, webServer
package.json             # + devDependency @playwright/test, + script test:browser
README.md                # short capability-based note (no static support table)
src/                     # unchanged
```

**Structure Decision**: extend in place (Q2 C); one extra pure module only so its branchy logic
is testable (research C8).

## Design Notes

### Capability classification → gating → outcome → overall

1. Load: dynamic import of `../dist/index.js` → import check (research C2).
2. Classify (C3) → show UA (diagnostic), secure context, presence, raw availability,
   classification.
3. Gate all 7 lifecycle checks (C4): SKIPPED / BLOCKED are recorded immediately; executable
   checks get their buttons active and stay "not run".
4. Executed check → PASS / FAIL / BLOCKED (C5).
5. Overall (C6): FAIL > BLOCKED > all-SKIPPED → SKIPPED > all-PASS → PASS > INCOMPLETE.
   INFO never read.
6. JSON (contract) re-rendered after every change; Copy JSON on click.

### The five existing checks

Bodies of `normalStreaming`, `earlyBreak`, `callerAbort`, `shutdownDuringStreaming`, `lazyStream`
stay byte-identical. They reference module-level `createRuntime` / `TaskError`, which become
`let` bindings filled by the dynamic import. `runTest` changes only in what it records (status
object instead of a boolean, NotAllowedError → BLOCKED).

### User activation

Every check has its own button, always rendered. Run All iterates the executable checks; a
refusal during Run All becomes BLOCKED for that check (not FAIL), and the user can rerun it from
its own button, which replaces the recorded result.

### Evidence layers (never substitute)

| Layer | Runner | Evidence of |
|---|---|---|
| 1 | Node + fake provider | runtime semantics (98 + report logic) |
| 2 | Playwright Chromium / Firefox / WebKit (`runner.kind: "playwright"`) | harness, import safety, classification, gating, JSON on 3 engines |
| 3 | Manual real Chrome / Edge (`runner.kind: "manual"`) | real Prompt API lifecycle (7 checks) |
| 3 | Manual real Safari / Firefox | branded-browser capability |

Actual-Safari automation (macOS CI + safaridriver) is **not** in the 006 MVP (research C12):
the repo has no CI, it needs a macOS runner plus a WebDriver client, and it would only re-verify
the `API_ABSENT` path. Recipe documented for later; runner kind `ci-safari` reserved.

### Production modification gate

`src/` is not changed unless a real-browser run reproduces an AkariSP production defect (research
C10). Cross-browser differences in chunking, messages, latency, or error names are evidence only.
The `InvalidStateError` rule stays exactly as in 005. If a defect is reproduced, implementation
stops and it is raised as a separate decision.

### Scope exclusions

Second provider, WebLLM, Transformers.js, Prompt API polyfill, automatic fallback, provider
registry or selection, browser-specific runtime adapters or scheduler, a production capability
API, package split, React/Vue, performance benchmarks, telemetry, remote result collection,
Selenium/Puppeteer, actual-Safari CI in 006, UA parser, JSON schema library, automatic model
download, replacing real-model lifecycle checks with automated engines.

## Test Strategy

1. **Baseline** (recorded above; rerun before the first edit).
2. **Pure logic first**: `smoke/report.js` + `test/report.test.ts` → pass; 98 existing unchanged.
3. **Harness**: extend `streaming.js` / `.html`; `git diff` shows the five check bodies unchanged.
4. **Automated engines (Layer 2)**: add Playwright (confirm the engine download first) →
   `npm run test:browser` passes on Chromium, Firefox, WebKit.
5. **Real browsers (Layer 3, manual, user-run)**: Chrome with the model available → import +
   7 PASS, overall PASS, and the five preserved checks pass as before; Edge / Safari / Firefox as
   available; Copy JSON; save evidence only for runs actually performed.
6. **Final**:
   - A. 98 existing + report tests pass; `tsc`; build.
   - B. Playwright passes on 3 engines.
   - C. Real-browser results only as run, others NOT TESTED.
   - `git diff` of `src/` is empty; `package.json` changes only the dev dependency and script,
     and runtime `dependencies` stays absent.
   - `grep userAgent smoke/` shows display/JSON use only.
   - No `fetch`/`sendBeacon`/`XMLHttpRequest`/`WebSocket` in `smoke/`.
   - No direct `LanguageModel.create` in the harness.
   - Nothing reads `smoke/results/`.
   - The INFO test passes.

## Complexity Tracking

No constitution violations; section intentionally empty.
