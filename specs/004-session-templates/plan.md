# Implementation Plan: Named Session Templates

**Branch**: `004-session-templates` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-session-templates/spec.md`

## Summary

Replace the single `base` variable with a fixed `Map` of base sessions (`bases`). Key
`undefined` is the unnamed default template, built from `session` exactly as today. Each task
resolves its template with a tiny `pick()` before admission and passes the selected base into
the existing `acquire()`, the only place that clones. Everything else is shared as-is:
admission, queue, slot lifecycle, streaming, broken (runtime-wide), snapshot, and shutdown
(which now destroys every base). The public API gains one config field
(`RuntimeOptions.templates`) and one per-task option (`template`), with no new exported names.

## Technical Context

**Language/Version**: TypeScript 5.x → ES2022 ESM (unchanged)

**Primary Dependencies**: none at runtime (unchanged)

**Storage**: N/A

**Testing**: `node:test` with the existing fake `LanguageModel` (unchanged; per-call create
failure is simulated in-test by wrapping `LanguageModel.create`)

**Target Platform**: desktop Chrome Prompt API (unchanged)

**Project Type**: library

**Performance Goals**: no new claim; template lookup is O(1)

**Constraints**: one scheduler; fixed registry; no new exported names; 001–003 tests unchanged

**Scale/Scope**: `src/index.ts` about +25 / −4 lines; tests appended

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Small Core | ✅ | Session lifecycle only; no routing, auto-selection, or agent concepts |
| II. Browser Native First | ✅ | Each base via `LanguageModel.create()` |
| III. Benchmark Driven | ✅ | No performance claim |
| IV. Minimal Overhead | ✅ | One `Map.get` per task; no per-template scheduler state |
| V. Explicit Lifecycle | ✅ | Runtime creates and owns every base; creation failure cleans up; shutdown destroys each once |
| VI. Context Safety | ✅ | Clone source is the selected template's base only; clone-per-task unchanged |
| VII. Framework Agnostic | ✅ | Unchanged |
| VIII. No Premature Provider Abstraction | ✅ | Templates are same-provider configurations, not providers |
| IX. Native Features Before Reinvention | ✅ | `Map`, `TypeError`, existing lifecycle |
| X. Scope Discipline | ✅ | No cache, eviction, dynamic registry, per-template metrics (FR-315) |
| XI. Reliability Over Feature Count | ✅ | Shared backpressure; invalid selection consumes nothing; broken semantics unchanged |
| XII. Public API Stability | ✅ | +1 option field, +1 task option; no new exported names or error codes; existing calls unchanged |

**Post-design re-check**: ✅ All gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/004-session-templates/
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
src/index.ts             # bases Map + creation/cleanup, pick(), acquire(base, …), run/stream option, shutdown loop, types
test/runtime.test.ts     # template tests appended; 001–003 tests untouched
README.md                # short "Templates" section
```

**Structure Decision**: Single module, unchanged layout.

## Design Notes

### Edits to existing code (all in `src/index.ts`)

| Location | Change |
|---|---|
| `RuntimeOptions` | + `templates?: Record<string, object>` with doc comment; `session` doc says "default template" |
| `Runtime.run` / `stream` signatures | options type gains `template?: string` |
| `createRuntime` after validation | build `bases` (research T2): `TypeError` for `{}` without session; default first; templates in key order; on `create()` rejection destroy the created ones and rethrow |
| new `pick(template)` | `bases.get(template)` or `TypeError` (research T4) |
| `acquire` | takes `base` as the first parameter (research T5) |
| `run` | `const base = pick(template)` as the first statement, then `acquire(base, …)` |
| `stream` generator | `const base = pick(template)` after the `used` check, before `admit`; `acquire(base, …)` |
| `shutdown` | destroy every value of `bases` (each in `try/catch`) |

### Unchanged by design

`admit`, `release`, `drain`, `end`, `failure`, `snapshot`, `closing` and `idle` logic, the
streaming cleanup machinery, and the `TaskError` code set.

### Regression risk

- **Creation path (low-medium).** It must still call `create(session)` first, with the same
  object identity, and propagate a single `create` rejection unchanged. Existing 001 tests
  cover both.
- **`acquire` signature (low).** There are two call sites, both updated.
- **Shutdown (low).** A loop replaces one call. Existing shutdown tests cover the default base.
- **Gate.** 76/76 existing tests run unchanged before the first edit and after the last.

## Test Strategy

1. Regression gate: 76/76 before any change.
2. Template tests (quickstart.md table) appended to `test/runtime.test.ts`:
   - Base identification uses `fake.sessions.filter(s => s.isBase)` and each base's
     `initialPrompts` history.
   - The create-failure case wraps `LanguageModel.create` inside the test.
3. Final: all tests pass unchanged, `tsc` and build pass, and `.d.ts` shows only the two new
   fields with no new exported names.

## Complexity Tracking

No constitution violations; section intentionally empty.
