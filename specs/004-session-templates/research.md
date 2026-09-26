# Research: Named Session Templates

Builds on 001 (R1–R9), 002 (S1–S7), 003 (P1–P5). Decisions follow the spec Clarifications.

## T1. Template configuration shape

- **Decision**: `RuntimeOptions.templates?: Record<string, object>`. Each value is passed
  unchanged to `LanguageModel.create()`, exactly like the existing `session` option.
- **Rationale**: Clarification Q1 (configuration, runtime creates and owns each base). A flat map
  of name → create options reuses the `session` contract with no new type. Duplicate names
  cannot be expressed in an object literal, so no duplicate check is coded.
- **Alternatives rejected**: `{ momentum: { session: {...} } }` nesting (an extra wrapper with
  one field; per-template options can be added later by accepting either shape); accepting live
  session objects (ambiguous ownership, Q1).

## T2. Base-session registry

- **Decision**: One `Map<string | undefined, Session>` named `bases`, built once in
  `createRuntime` and never mutated afterwards. Key `undefined` is the unnamed default template.
  - The default base is created when `templates` is absent (existing behavior, including
    `createRuntime()` with no options) or when `session` is given alongside `templates`.
  - Templates are created after the default, in object key order.
- **Rationale**: A `Map` gives exact-key lookup with no prototype keys (`"constructor"` is not a
  hit). Creating the default first keeps `LanguageModel.create`'s first call equal to today's,
  so the existing "session options pass to create unchanged" test is unaffected.
- **Creation failure**: bases are created sequentially. If one `create()` rejects, every base
  already created is destroyed (errors swallowed) and the original error is rethrown unchanged
  (FR-309). ponytail: sequential creation multiplies startup latency by template count;
  parallelize with `Promise.allSettled` if startup time matters.
- **Validation**: `templates` given with zero keys and no `session` → `TypeError` before any
  `create()` (FR-308). Existing `limit`/`queueCapacity` validation is unchanged and still runs
  first.

## T3. Template selection API

- **Decision**: Per-task option `template?: string` next to `signal`, for both `run` and
  `stream`: `run(input, { signal, template })`.
- **Comparison** (from the spec):

  | Concern | Option `{ template }` | Leading argument `run(name, input)` |
  |---|---|---|
  | Backward compatibility | Existing calls unchanged | Existing calls unchanged only via overloads |
  | Overload ambiguity | None | `run('x')` could be a prompt or a template name |
  | TypeScript inference | Same signature, one extra optional field | Overload set needed |
  | Future per-task options | Same object | Another positional or options object anyway |
  | Implementation size | One destructured field | Argument shuffling in two methods |

- **Types**: The options type stays inline (`{ signal?: AbortSignal; template?: string }`) in
  both signatures; no new exported name.

## T4. Template resolution and errors

- **Decision**: A closure `pick(template)` returns `bases.get(template)` or throws `TypeError`:
  - unknown name → `TypeError('unknown template "<name>"')`
  - no name and no default base → `TypeError('template is required: this runtime has no default session')`
- **Where it runs**:
  - In `run()` it is the first statement of the async function, so it becomes a rejected
    promise before `admit`: no queue entry, slot, clone, or state change (FR-307, FR-313).
  - In `stream()` it runs inside the generator body after the single-use check and before
    `admit`, so it happens at the first pull. Stream creation stays side-effect free (FR-306).
- **Error kind**: `TypeError`, the existing argument/config error mechanism (`createRuntime`
  validation, second stream iteration). It is not a new `TaskError` code, and `TaskError`'s
  code union is unchanged. It does not set `stream.timing` (same as the single-use
  `TypeError`).
- **Precedence**: `pick` runs before `admit`, so an invalid template is reported as
  `TypeError` even when the runtime is broken or closed. This matches the spec edge case
  ("exactly one error, nothing consumed").

## T5. Clone source

- **Decision**: `acquire` takes the selected base as a parameter:
  `acquire(base, sig, timing)`. It is the only place that clones, so this is the single edit
  that routes clones to the right template (FR-303). The broken transition inside `acquire` is
  unchanged: runtime-wide (Q2, FR-311).

## T6. Shutdown

- **Decision**: Replace the single `base.destroy()` with a loop over `bases.values()`, each in its
  own `try {} catch {}`, after the existing `idle` wait. Each base is destroyed exactly once
  because the `closing` promise already makes shutdown single-flight (FR-310).

## T7. Snapshot

- **Decision**: No change. It stays runtime-wide (FR-312).
