# Implementation Plan: Registry Consumer Validation

**Branch**: `009-registry-consumer-validation` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-registry-consumer-validation/spec.md`

## Summary

Add one on-demand check that validates what npm actually serves against a written per-release
intent. Use it on the existing `0.1.0-alpha.0` and on a documentation/metadata correction release,
`0.1.0-alpha.1`, published through an explicit procedure. Production source is untouched.

| Change | Where | Evidence |
|---|---|---|
| Per-release intent (retroactive for alpha.0) | `releases/0.1.0-alpha.0.json`, `releases/0.1.0-alpha.1.json` | R1 |
| Registry check: metadata vs intent (10 min / 20 s re-reads), untagged and `alpha` installs, public/internal imports, 3 resolution modes, result file | `test/registry/registry.test.ts`, script `test:registry` (explicit file) | R2–R4, R6 |
| Shared consumer helpers for 008 (tarball) and 009 (registry) | `test/consumer.ts` (moved from `test/package.test.ts`) | R5 |
| `publishConfig` removed; version `0.1.0-alpha.1`; 008 version literal updated | `package.json`, `test/package.test.ts` | G3, R7 |
| README Install (current release state) and Release (explicit procedure) | `README.md` | R8 |
| 008 "First publish" attribution corrected; discrepancy record | 008 `research.md`, 009 `research.md` | R8 |
| Publish alpha.1, move `latest`, verify, commit result | maintainer + `releases/0.1.0-alpha.1.verified.json` | FR-915 |

## Technical Context

**Language/Version**: TypeScript 5.9, Node ≥ 22.18 (tests only). Unchanged.

**Primary Dependencies**: none at runtime. No new development dependency either: the check uses
npm, Node's child processes, and the repository TypeScript.

**Storage**: committed JSON under `releases/`. Not packed (`files: ["dist"]`).

**Testing**: `node:test`. The offline `npm test` stays unchanged in scope. `npm run test:registry`
is on demand and needs the network.

**Target Platform**: unchanged (browsers). The check runs on the maintainer's machine.

**Project Type**: single-package library.

**Performance Goals**: N/A. The registry check takes seconds when the registry is settled (G2)
and at most about 10 minutes of re-reads otherwise.

**Constraints**:
- 0 `src/` changes and 0 new dependencies.
- The offline suite must not touch the network.
- Publishing and tag changes are done by the maintainer only.
- No release automation.

**Scale/Scope**:
- 2 intent files and 2 result files (alpha.1's after publish);
- 1 new test file and 1 helper module;
- 1 script;
- 3 documentation touch-points.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I Small Core, IV Minimal Overhead, V/VI/XI lifecycle | PASS | No runtime change |
| II Browser Native First, VII Framework Agnostic, X Scope | PASS | Nothing added to the package |
| III Benchmark Driven | N/A | No performance claim |
| VIII Provider Extensibility | PASS | No provider or SPI change |
| IX Native Features | PASS | npm CLI, `node:test`, and child processes; no release tooling |
| XII Public API Stability | PASS | The public surface is unchanged. `0.1.0-alpha.1` changes only README and package metadata (`publishConfig` removed, which is not API). The 008 snapshot guards this |

Post-design re-check: PASS. No violations, so no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/009-registry-consumer-validation/
├── plan.md
├── research.md          # G1–G3, R1–R8, discrepancy record (filled during implement)
├── data-model.md        # intent, registry state, result, transitions
├── quickstart.md        # V1–V7
├── contracts/
│   └── release-procedure.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
releases/
├── 0.1.0-alpha.0.json            # NEW, retroactive intent
├── 0.1.0-alpha.0.verified.json   # NEW, result of V2
├── 0.1.0-alpha.1.json            # NEW, intent written before publishing
└── 0.1.0-alpha.1.verified.json   # NEW, result of V5 (after the maintainer publishes)
test/
├── consumer.ts                   # NEW: run / tsc / internal list, shared by the two tests below
├── package.test.ts               # uses test/consumer.ts; version literal → 0.1.0-alpha.1
├── registry/registry.test.ts     # NEW: on-demand registry check
└── consumer/*.ts                 # shared fixtures (unchanged)
package.json                      # - publishConfig; version 0.1.0-alpha.1; + test:registry
README.md                         # Install + Release sections
specs/008-…/research.md           # dated correction of "First publish"
```

**Structure Decision**: single package, as before. `src/` is untouched.

## Implementation order (for /speckit-tasks)

1. **Shared helpers.** Move the helpers into `test/consumer.ts` and confirm the offline `npm test`
   is unchanged: 145 tests, no assertion change yet.
2. **Retroactive intent.** Write `releases/0.1.0-alpha.0.json`.
3. **Registry check and first run.** Implement `test/registry/registry.test.ts` and
   `test:registry`, then run V2 against alpha.0 and commit the result.
4. **Mutation check (V3).** Show that a wrong intent is reported.
5. **Metadata and docs.**
   - Remove `publishConfig` (V4), bump the version, and update 008's version literal.
   - Update the README Install and Release sections.
   - Correct the 008 research.
   - Write the alpha.1 intent.
   - Run the offline suite.
6. **Maintainer publish (V5).** From the pushed, reviewed 009 branch (single PR; no merge
   before publishing), the maintainer runs `npm publish --tag alpha` and
   `npm dist-tag add akarisp@0.1.0-alpha.1 latest`. Then run the check and commit the result to
   the same branch. A mismatch is handled per FR-920.
7. **Final record (V6, V7).** Check the npm page, then complete the discrepancy record.

## Complexity Tracking

None.
