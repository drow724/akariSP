# Implementation Plan: Framework Compatibility Validation

**Branch**: `010-framework-compatibility-validation` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-framework-compatibility-validation/spec.md`

## Summary

Four minimal, committed, version-pinned applications consume the **published**
`akarisp@0.1.0-alpha.1`: React + Vite, Vue + Vite, Svelte + Vite, and Next.js (App Router). Each
owns a runtime through its framework's ordinary mount/unmount primitive.

- **Automated runs** (production builds, a stand-in `LanguageModel` global) check that every
  runtime and every task is cleaned up across mount/unmount, including an unmount during a
  stream. For Next.js they also check the server/client boundary.
- **Manual runs** (development servers, the real Chrome Prompt API) record StrictMode and HMR
  behavior.

The result is one record per environment and one evidence-backed conclusion per ecosystem.
Production source is untouched, and no adapter is built.

| Change | Where | Evidence |
|---|---|---|
| 4 fixtures, JavaScript, exact pins + lockfiles, `akarisp` 0.1.0-alpha.1 from the registry | `fixtures/{react-vite,vue-vite,svelte-vite,next}/` | R1, F3 |
| Straightforward owner pattern first; the fixed pattern only if evidence requires it | the owner component in each fixture | R2 |
| Test-only stand-in `LanguageModel` with counters | `fixtures/standin.js` | R3 |
| Automated spec and a separate config and script | `e2e-frameworks/frameworks.spec.ts`, `playwright.frameworks.config.ts`, `"test:frameworks"` | R4 |
| Manual run records | `fixtures/results/*.json` | R5 |
| Next.js server-import and server-create probe routes | `fixtures/next/app/{server-import,server-create}/page.jsx` | R6, F1, F2 |
| Conclusions and README section | 010 `research.md`, `README.md` | R7 |

## Technical Context

**Language/Version**: fixtures are plain JavaScript. The spec and config are TypeScript run by
the existing Playwright 1.63. The repository TypeScript 5.9 is unchanged.

**Primary Dependencies**: per-fixture only, pinned exactly (F3):
- vite 8.3.1;
- react/react-dom 19.3.0 with @vitejs/plugin-react 6.1.1;
- vue 3.5.43 with @vitejs/plugin-vue 6.0.9;
- svelte 5.57.1 with @sveltejs/vite-plugin-svelte 7.3.1;
- next 16.3.6.

The repository root gains no dependency.

**Storage**: committed fixture lockfiles and `fixtures/results/*.json`.

**Testing**: Playwright on Chromium for automated runs, plus guided manual runs. The offline
`npm test` and `test:browser` are unchanged.

**Target Platform**: desktop Chrome/Chromium.

**Project Type**: single-package library plus test-only fixture applications.

**Performance Goals**: N/A.

**Constraints**:
- 0 `src/` changes and 0 root dependencies.
- No framework-specific AkariSP API.
- `npm ci` for the fixtures needs network access and user approval (R8).
- No model or browser download.

**Scale/Scope**:
- 4 fixtures, each with about 3–5 small files;
- 1 stand-in;
- 1 spec;
- 1 config;
- 4 manual records;
- 1 README section.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I Small Core, IV Minimal Overhead, XI Reliability | PASS | No core change |
| II Browser Native First | PASS | Fixtures use the Prompt API: a stand-in for automation, the real API for the manual run |
| V Explicit Lifecycle | PASS | This feature tests that frameworks can keep the lifecycle explicit, with ownership in application code |
| VII Framework Agnostic, X Scope Discipline | PASS | Framework code lives only in test fixtures; there is no framework dependency in the package; adapters are explicitly deferred |
| VIII Provider Extensibility | PASS | No provider change; the stand-in is test-only |
| IX Native Features | PASS | Framework primitives only; no helper library |
| XII Public API Stability | PASS | The public surface is unchanged (008 snapshot) |
| III Benchmark Driven | N/A | No performance claim |

Post-design re-check: PASS. No violations, so there is no Complexity Tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/010-framework-compatibility-validation/
├── plan.md
├── research.md          # F1–F3, R1–R8; results table and conclusions (implement)
├── data-model.md        # environment, stand-in counters, result record, conclusion
├── quickstart.md        # V1–V5, M1–M4
├── contracts/
│   └── fixture-contract.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
fixtures/
├── standin.js                    # test-only LanguageModel stand-in (R3)
├── react-vite/  {package.json, package-lock.json, index.html, vite.config.js, src/main.jsx, src/Owner.jsx}
├── vue-vite/    {package.json, package-lock.json, index.html, vite.config.js, src/main.js, src/App.vue, src/Owner.vue}
├── svelte-vite/ {package.json, package-lock.json, index.html, vite.config.js, src/main.js, src/App.svelte, src/Owner.svelte}
├── next/        {package.json, package-lock.json, next.config.mjs, app/layout.jsx, app/page.jsx, app/toggle.jsx, app/owner.jsx,
│                 app/other/page.jsx, app/server-import/page.jsx, app/server-create/page.jsx}
└── results/                      # manual + automated records
e2e-frameworks/frameworks.spec.ts # automated ownership + Next.js boundary (R4, R6)
playwright.frameworks.config.ts   # 4 webServers (npm ci && build && preview/start)
package.json                      # + "test:frameworks"
README.md                         # + "Using with frameworks" (after evidence)
```

**Structure Decision**: fixtures are test assets beside the package, not packages of it. There
is no workspace, and the root `package.json` gains only a script.

## Implementation order (for /speckit-tasks)

1. Write the stand-in and the fixture contract. Scaffold one fixture (React + Vite) with the
   straightforward owner, pinned versions, and the registry `akarisp`. This needs approval for
   `npm install`.
2. Write the automated spec and config, and get React green or record its findings.
3. Build the Vue, Svelte, and Next.js fixtures the same way, including the Next.js probe routes.
4. Run the automated suite, then record the results.
5. Do the manual runs (development servers, real Prompt API, StrictMode, HMR) per environment,
   and record them.
6. If a straightforward owner leaks, add the fixed pattern, re-run both, and record both.
7. Write the conclusions (FR-1018) and the README section (FR-1019). Check that `src/` is
   unchanged and that V1 still passes.

## Complexity Tracking

None.
