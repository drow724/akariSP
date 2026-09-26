# Implementation Plan: Core / Browser Provider Boundary

**Branch**: `005-core-provider-boundary` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-core-provider-boundary/spec.md`

## Summary

Move today's `src/index.ts` to `src/core/runtime.ts` and replace its only two browser-bound
calls (`LanguageModel.create(...)`) with `provider.create(...)`, where `provider` is the new first
argument of an internal `createCoreRuntime(provider, options)`. The `LanguageModel` declaration
moves to `src/browser/runtime.ts`, which defines a one-method adapter that reads the global
lazily and the unchanged public `createRuntime(options)`. `src/index.ts` re-exports exactly the
004 names. Native sessions already satisfy the internal `Session` contract, so they pass through
unwrapped. All policy stays in core byte-for-byte; the existing suite is retargeted to core with
a fake provider by changing only its harness; one small browser test file and one boundary test
file are added. One package, zero dependencies, no new public export.

## Technical Context

**Language/Version**: TypeScript 5.9 → ES2022 ESM (unchanged); `tsconfig` gains
`rewriteRelativeImportExtensions` (research B7)

**Primary Dependencies**: none at runtime (unchanged)

**Storage**: N/A

**Testing**: `node:test` with native type stripping (Node ≥ 22.18; 23.9 locally). Baseline:
**89/89** passing on `005-core-provider-boundary` before any edit.

**Target Platform**: desktop Chrome Prompt API via the browser entry; core is loadable in any
ES2022 environment with standard web-platform globals (`AbortSignal`, `DOMException`,
`performance`)

**Project Type**: library (single npm package `akarisp`)

**Performance Goals**: no new claim; one extra function hop per base creation only; zero per-task
overhead (sessions are not wrapped)

**Constraints**: public exports identical to 004; core has no browser-AI reference; no npm
workspaces; no new package.json; policy code not modified

**Scale/Scope**: production ≈ +15 / −6 lines beyond the file move (see Diff size); tests: harness
lines only in the existing suite, plus two small new files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Small Core | ✅ | No new runtime concept; core is today's code minus one global |
| II. Browser Native First | ✅ | Browser entry still maps directly to `LanguageModel`; native sessions used as is |
| III. Benchmark Driven | ✅ | No performance claim; bench keeps working through the unchanged public entry |
| IV. Minimal Overhead | ✅ | Zero per-task indirection; one wrapper call per base creation |
| V. Explicit Lifecycle | ✅ | Creation order, rollback, clone/destroy, shutdown order unchanged in core |
| VI. Context Safety | ✅ | Clone-per-task unchanged; provider never sees template names |
| VII. Framework Agnostic | ✅ | Unchanged; layout keeps `browser → core` for a later `react → browser → core` |
| VIII. Provider Extensibility Without Premature Abstraction | ✅ | Contract = the 5 operations already used; internal until 006 validates it with a second provider |
| IX. Native Features Before Reinvention | ✅ | Plain interfaces and a function argument; no DI, registry, or lint framework |
| X. Scope Discipline | ✅ | No second provider, availability, capabilities, health, retries (FR-414) |
| XI. Reliability Over Feature Count | ✅ | Staged gates keep the 89 tests green at each step; boundary enforced by a test |
| XII. Public API Stability | ✅ | Same exports, same signatures, same import path; verified by test and `.d.ts` |

**Post-design re-check**: ✅ All gates pass. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/005-core-provider-boundary/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/public-api.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── core/
│   └── runtime.ts       # git mv of today's src/index.ts; Session + SessionProvider (internal),
│                        # createCoreRuntime(provider, options), public types, TaskError
├── browser/
│   └── runtime.ts       # declare LanguageModel; promptApi adapter; public createRuntime(options)
└── index.ts             # re-exports the 004 public names only
test/
├── runtime.test.ts      # existing 89 tests → core via fake provider (harness lines only)
│                        #   + 1 appended test pinning the existing broken condition
├── browser.test.ts      # NEW: create delegation, config identity, native pass-through,
│                        #      lazy global read, import without global, entry wiring
└── boundary.test.ts     # NEW: static core scan, import-without-global, public value exports
tsconfig.json            # + rewriteRelativeImportExtensions
```

`package.json`, `smoke/`, `bench/` unchanged (they import `dist/index.js`).

**Structure Decision**: one file per area (research B5). The contract lives with its only
policy consumer; no `provider.ts` files, no class, no registry.

## Design Notes

### What stays in core (unchanged code)

Option validation, empty-templates check, `bases` creation order and rollback, `pick`, `state`,
`closer`, `running`, `queue`, `closing`, `idle`, `drain`, `release`, `admit`, `failure`,
`acquire` (including the `InvalidStateError` → broken rule), `end`, `snapshot`, `run`, `stream`
(lazy start, single use, single-flight cleanup, paused-consumer abort listener, timing), and
`shutdown` (closed → drain → abort → idle gate → destroy all bases). `TaskError`, `TaskTiming`,
and all public types.

### Edits (all mechanical)

| File | Change |
|---|---|
| `src/core/runtime.ts` (moved) | delete `declare const LanguageModel`; `export` `Session`; add `export interface SessionProvider { create(config?: object): Promise<Session> }`; rename `export async function createRuntime(options = {})` → `export async function createCoreRuntime(provider: SessionProvider, options: RuntimeOptions = {})`; the two `LanguageModel.create(x)` → `provider.create(x)`; reword the header comment and the two `RuntimeOptions` doc comments to "the session provider's create()" |
| `src/browser/runtime.ts` (new) | `import { createCoreRuntime, type RuntimeOptions, type SessionProvider } from '../core/runtime.ts'`; `declare const LanguageModel: SessionProvider;`; `const promptApi: SessionProvider = { create: (config) => LanguageModel.create(config) };`; `export function createRuntime(options?: RuntimeOptions): Promise<Runtime> { return createCoreRuntime(promptApi, options); }` (004 declaration form) with the existing public doc intent |
| `src/index.ts` (new) | `export { createRuntime } from './browser/runtime.ts'`; `export { TaskError } from './core/runtime.ts'`; `export type { RuntimeOptions, Runtime, RuntimeSnapshot, TaskStream, TaskResult, TaskTiming } from './core/runtime.ts'` |
| `tsconfig.json` | + `"rewriteRelativeImportExtensions": true` |

`createRuntime` keeps its 004 declaration `function createRuntime(options?: RuntimeOptions):
Promise<Runtime>`. It is not `async`, but it only calls the `async` `createCoreRuntime` and reads
no global itself, so every failure is still a rejection (research B3).

Final source dependencies:

```text
src/index.ts
 ├─> src/browser/runtime.ts
 └─> src/core/runtime.ts   // TaskError and public type re-export

src/browser/runtime.ts
 └─> src/core/runtime.ts
```

Invariants: core → browser = 0; core → `LanguageModel` = 0. The direct `index → core`
re-export is allowed. `src/core` imports nothing.

### Order preserved exactly

- **Creation**: validation `TypeError`s → `provider.create(default)` (if any) → each template in
  key order → on a rejection, destroy each created base (errors swallowed) → rethrow the
  original error. A failed `create()` returns nothing, so it is never destroyed.
- **Shutdown**: `state = 'closed'` → drain queue (`'closed'`) → abort running tasks → await idle
  (each task: destroy clone → release) → destroy every base once.
- **Global absent**: `createRuntime()` rejects with the same `ReferenceError` as today, after
  validation; importing any module does not read the global.

### Diff size

- Production beyond the move: `core/runtime.ts` ≈ +3 / −3 plus 3 reworded comment lines;
  `browser/runtime.ts` ≈ 8 lines (create adapter + entry only; no session wrapper); `index.ts` ≈ 3 lines; `tsconfig.json` +1. Total ≈ +15 / −6.
- Tests: `runtime.test.ts` ≈ 5 harness lines changed, 0 assertion lines; `browser.test.ts`
  ≈ 40 lines; `boundary.test.ts` ≈ 30 lines.

### Regression risk

- **Build/import resolution (medium, checked first)**: `.ts` specifiers and type-only
  re-exports must work under Node type stripping, `tsc` emit, the browser loading `dist/`, and
  consumer type resolution. Verified in a scratch project (research B7); Gate 2 re-checks it on
  the real code.
- **Type re-export slip (low)**: exporting a type without `export type` breaks at runtime under
  type stripping; caught immediately by `npm test`.
- **Lazy global read (low)**: covered by the missing-global browser test and the core import
  test.
- **Broken rule (none)**: `e instanceof DOMException && e.name === 'InvalidStateError'` is
  moved unchanged; not generalized to name-only (research B4; 006 revisits if needed).
- **Semantics (low)**: policy code is moved, not edited; the unmodified suite runs through the
  new public path before the harness is retargeted.
- **Broken-rule pin (added test)**: one core regression test fixes the existing condition: a
  clone error `{ name: 'InvalidStateError' }` that is not a `DOMException` fails the task with
  `'failed'` and leaves the runtime `ready`.
- **Test harness retarget (low)**: only harness lines change; reviewed by diff showing no
  assertion lines touched.

## Test Strategy (staged gates)

Each gate must be green before the next step.

1. **Baseline**: `npm test` 89/89, `npx tsc --noEmit -p .` clean, record `BASE=$(git rev-parse
   HEAD)` (the 004 merge; local `main` is stale) and the 004 `dist/index.d.ts` export names.
2. **Contract + move**: `git mv src/index.ts src/core/runtime.ts`; add `SessionProvider`, export
   `Session`, add `createCoreRuntime(provider, …)`, replace the two calls; create
   `src/browser/runtime.ts` and the re-exporting `src/index.ts`; add the tsconfig flag. Run the
   **unmodified** `test/runtime.test.ts` (still installs `globalThis.LanguageModel` and imports
   `../src/index.ts`) → 89/89 through browser → core. `tsc` clean.
3. **Retarget suite to core**: change only the harness (research B9) → 89/89; `git diff
   test/runtime.test.ts` shows no assertion lines changed.
4. **Browser adapter tests**: add `test/browser.test.ts` covering only browser-owned
   responsibilities (research B9) → pass. No session wrapper is added for testability.
5. **Boundary**: add `test/boundary.test.ts` → pass; then temporarily add a `LanguageModel`
   reference in core to see it fail, and revert (manual sanity check, not committed).
6. **Public API and policy diff**: `npm run build`; public names equal the 004 list and public
   type shapes are identical to `$BASE` (research B8 fixture); `dist/index.js` runtime keys are
   `createRuntime`, `TaskError`; `package.json` unchanged vs `$BASE`. Policy diff:
   `git diff $BASE -M -B -- src/` (rewrite detection, since `src/index.ts` remains) shows
   `index.ts → core/runtime.ts` with only the provider-injection and comment edits.
7. **Real Chrome smoke**: `smoke/streaming.html` Run All → 5/5 (manual, user-run; the model must
   already be downloaded).

README: one short sentence under Usage or a "Layout" note is optional; no user-facing change to
document. Decide in tasks.

## Complexity Tracking

No constitution violations; section intentionally empty.
