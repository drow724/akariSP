# Implementation Plan: Package and Public API Stabilization

**Branch**: `008-package-public-api-stabilization` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-package-public-api-stabilization/spec.md`

## Summary

Freeze the first-release surface of the single `akarisp` package:

```ts
import { createRuntime, TaskError, type Runtime } from 'akarisp';   // Chrome Prompt API
import { createWebLLMRuntime } from 'akarisp/webllm';                // application-created engine
// both factories: Promise<Runtime>, the same provider-neutral contract
```

The factories are provider-specific; everything they return is provider-neutral. The work is
types, packaging, verification, and documentation. No runtime behavior changes.

| Change | Where | Evidence |
|---|---|---|
| `akarisp/webllm` subpath exporting only `createWebLLMRuntime` | new `src/webllm.ts` (1 line), `package.json` `exports` | Q1, R1 |
| `interruptGenerate(): void \| Promise<void>` in the structural engine type | `src/webllm/runtime.ts` | R2, confirmed by V5 |
| `readonly` on `RuntimeSnapshot` fields | `src/core/runtime.ts` | R4 |
| `version` `0.1.0-alpha.0`, `publishConfig.tag` `alpha`, `license`, `repository`, description, `prepack`; `engines` removed | `package.json` | Q2, R5 |
| Packed-tarball consumer test + public API snapshot | `test/package.test.ts`, `test/consumer/*.ts`, `api/akarisp.api.txt` | R7, R8 |
| Smoke loads the public WebLLM entry | `smoke/webllm.js` (1 import) | R9 |
| README: `@alpha` install, Chrome first, official WebLLM section, per-provider wording | `README.md` | Q3, R10 |

Root exports stay the same 8 names (R3); run/stream options stay anonymous (R4); the provider SPI
stays internal; runtime dependencies stay 0; ESM only (R6).

## Technical Context

**Language/Version**: TypeScript 5.9 → ES2022 (unchanged)

**Primary Dependencies**: none at runtime. Dev: TypeScript (also used by the snapshot script),
Playwright. No new dependency.

**Storage**: N/A

**Testing**: `node:test` (Node ≥ 22.18, native type stripping). The new package test runs
`npm pack` and an offline consumer install in a temp directory. Existing Playwright and real
browser smoke pages are unchanged.

**Target Platform**: browsers (Chrome Prompt API; WebGPU browsers for WebLLM) through bundlers or
native ESM. Node is the development environment only.

**Project Type**: single-package library

**Performance Goals**: N/A (no runtime change). Size is recorded: 12.1 kB packed before, re-measured after.

**Constraints**:
- 0 runtime dependencies;
- no model or Playwright binary downloads;
- V5 is a one-time npm package download that requires user permission;
- no weakening of existing assertions;
- lifecycle code untouched.

**Scale/Scope**:
- 9 public names (8 kept, 1 added);
- 2 entry points;
- 13 tarball files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I Small Core | PASS | Core logic untouched; one type annotation |
| II Browser Native First | PASS | Chrome stays the root entry. WebLLM is published as a subpath with no dependency; its justification is 007's evidence |
| III Benchmark Driven | N/A | No performance claim |
| IV Minimal Overhead | PASS | Nothing added on hot paths |
| V Explicit Lifecycle | PASS | WebLLM ownership rules become public documentation (FR-819) |
| VI Context Safety | PASS | Unchanged |
| VII Framework Agnostic | PASS | No framework code |
| VIII Provider Extensibility w/o Premature Abstraction | PASS | Provider SPI stays internal; no registry or factory API |
| IX Native Features | PASS | npm `exports` and `publishConfig` instead of tooling; TypeScript compiler API already installed |
| X Scope Discipline | PASS | No split or framework packages |
| XI Reliability | PASS | Tarball allow-list and `prepack` build prevent stale or unintended files |
| XII Public API Stability | PASS | Every item reviewed ([data-model.md](data-model.md)). The only addition (`createWebLLMRuntime`) has a demonstrated need (Q1, 007). The snapshot guards the frozen surface. The `readonly` change happens before the first publish, so no migration note is needed |

Post-design re-check: PASS. There are no violations, so there is no Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/008-package-public-api-stabilization/
├── plan.md
├── research.md          # P1–P4 baseline experiments, R1–R10 decisions
├── data-model.md        # per-item public surface review, metadata, allow-list
├── quickstart.md        # V1–V9 validation
├── contracts/
│   └── public-api.md    # human-readable freeze candidate
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── index.ts             # root entry (unchanged)
├── webllm.ts            # NEW: export { createWebLLMRuntime } from './webllm/runtime.ts'
├── core/runtime.ts      # readonly RuntimeSnapshot fields
├── browser/runtime.ts   # unchanged
└── webllm/runtime.ts    # interruptGenerate return type widened
api/
└── akarisp.api.txt      # NEW: committed public surface snapshot
test/
├── package.test.ts      # NEW: pack → consumer install → types/imports/allow-list/snapshot
├── consumer/            # NEW: consumer files type-checked against the tarball
│   ├── root.ts
│   ├── webllm.ts
│   └── internal.ts      # each internal import must be a type error
└── boundary.test.ts     # + akarisp/webllm value exports
smoke/webllm.js          # import ../dist/webllm.js
smoke/results/           # dated 008 evidence
package.json
README.md
```

**Structure Decision**: single package, as before. The only new source file is the one-line
WebLLM entry; the rest are test, snapshot, and documentation files.

## Implementation order (for /speckit-tasks)

1. **Guard first.** Add the package test and consumer fixtures against the current package.
   They are expected to fail on the missing `akarisp/webllm`, `readonly`, and version, which
   proves they detect the changes.
2. **Make the changes.** Apply the type edits, `src/webllm.ts`, and `package.json`. Generate
   `api/akarisp.api.txt` and review it line by line against [contracts/public-api.md](contracts/public-api.md).
3. **Run V4.** Do the mutation check.
4. **Run V5.** Type-check a real `MLCEngine` against the engine type. This step needs permission
   because it downloads an npm package. If it contradicts R2, adjust the type and record the
   result.
5. **Update the smoke import and README.** Then run V1–V3 and V6.
6. **Re-run real browsers (V7, V8).** Record the dated evidence.

## Complexity Tracking

None.
