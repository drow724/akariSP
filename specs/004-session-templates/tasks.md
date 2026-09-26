---

description: "Task list for 004-session-templates"
---

# Tasks: Named Session Templates

**Input**: Design documents from `/specs/004-session-templates/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/public-api.md,
quickstart.md; features 001–003 implemented

**Tests**: Included (spec independent tests, SC-302–SC-306). Order follows the user's request:
regression gate → implementation → tests per story → polish.

**Organization**: All code is in `src/index.ts` and `test/runtime.test.ts`, so tasks are
sequential except where marked `[P]`. No template manager, registry abstraction, health map, or
second scheduler: the whole change is the `bases` Map plus `pick()`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from spec.md (US1–US5)

---

## Phase 1: Foundational

- [X] T001 Regression gate: before any edit run `npm test` and `npx tsc --noEmit -p .`; confirm 76/76 existing 001–003 tests pass with `test/runtime.test.ts` unmodified. Existing tests must not be edited at any point in this feature
- [X] T002 In `src/index.ts` apply the plan's edit table (research T1–T6), changing nothing else:
  - `RuntimeOptions`: add `templates?: Record<string, object>` with doc comment ("Named templates: name → options passed unchanged to LanguageModel.create(). Fixed for the runtime's lifetime. If given without `session`, there is no default template."); update the `session` doc to say it configures the unnamed default template
  - `run` / `stream` signatures in `Runtime`: options type becomes `{ signal?: AbortSignal; template?: string }` (inline; no new exported type)
  - in `createRuntime`, after the existing `limit`/`queueCapacity` validation, replace `const base = await LanguageModel.create(session)`:
    - throw `TypeError` if `templates` is given with zero keys and `session` is undefined (before any `create()`)
    - build `const bases = new Map<string | undefined, Session>()`, creating sequentially: first the default (`bases.set(undefined, await LanguageModel.create(session))`) when `templates === undefined || session !== undefined`, then each `Object.entries(templates ?? {})` in key order
    - wrap creation in `try/catch`: on any rejection, destroy every base already in `bases` (each destroy in its own `try {} catch {}` so one failure does not stop the rest) and rethrow the original error unchanged
    - add a `ponytail:` comment noting that sequential creation scales startup with template count
  - add `const pick = (template?: string) => { const base = bases.get(template); if (base) return base; throw new TypeError(template === undefined ? 'template is required: this runtime has no default session' : \`unknown template "${template}"\`); }`
  - `acquire(base: Session, sig, timing)`: clone from the parameter instead of the closure `base`; the broken transition inside is unchanged
  - `run(input, { signal, template } = {})`: `const base = pick(template);` as the first statement, then the existing flow with `acquire(base, sig, timing)`
  - `stream(input, { signal, template } = {})`: inside the generator, right after the `used` check and before `admit`, `const base = pick(template);`; then `acquire(base, sig, timing)`. Stream creation stays side-effect free
  - `shutdown`: replace `try { base.destroy(); } catch {}` with `for (const b of bases.values()) try { b.destroy(); } catch {}`
  - do not modify `admit`, `release`, `drain`, `end`, `failure`, `snapshot`, the streaming cleanup, `TaskError`, or its code set

**Checkpoint**: 76/76 still pass unmodified; `tsc` passes

---

## Phase 2: User Story 1 - Run tasks against a chosen template (Priority: P1) 🎯 MVP

**Goal**: A task clones exactly the template it names; contexts never mix

**Independent Test**: momentum/risk tasks each see only their own template's initial context; base histories unchanged

- [X] T003 [US1] In `test/runtime.test.ts` append template run/stream/isolation tests:
  - `createRuntime({ templates: { momentum: { initialPrompts: ['momentum'] }, risk: { initialPrompts: ['risk'] } } })` → exactly 2 bases (`fake.sessions.filter(s => s.isBase)`), histories `['momentum']` and `['risk']`
  - `run('m1', { template: 'momentum' })` → its clone history is `['momentum', 'm1']`; `run('r1', { template: 'risk' })` → `['risk', 'r1']`
  - `collect(runtime.stream('r2', { template: 'risk' }))` → clone history `['risk', 'r2']`
  - after all tasks, base histories are still exactly `['momentum']` and `['risk']`, and each base's `prompts === 0` (FR-303, FR-304, SC-302)

---

## Phase 3: User Story 2 - Templates share one scheduler (Priority: P1)

**Goal**: One limit, one FIFO queue, runtime-wide snapshot, lazy streams unchanged

**Independent Test**: limit 1 with a held momentum task and a waiting risk task → snapshot 1 active / 1 queued

- [X] T004 [US2] In `test/runtime.test.ts` append shared-scheduler tests:
  - `limit: 1`, three templates: held `run` on momentum, then `run` on risk → `snapshot()` deep-equals `{ state: 'ready', active: 1, queued: 1, limit: 1, queueCapacity: 32 }` (exactly these 5 keys)
  - FIFO across templates: `limit: 1`, held task A, then submit risk, momentum, summary in that order → clones happen in that order (check each clone's first history entry: `['risk', 'momentum', 'summary']`) (FR-305)
  - `limit: 2`: held momentum and held risk tasks plus a summary task → `active: 2, queued: 1` (spec example)
  - lazy named stream: `runtime.stream('x', { template: 'risk' })` never pulled → `fake.clones` and snapshot counts unchanged (FR-306)

---

## Phase 4: User Story 3 - Invalid template selection fails without side effects (Priority: P2)

**Goal**: Unknown or missing template → `TypeError`, nothing consumed

**Independent Test**: unknown template while another task runs → `TypeError`, snapshot and clone count unchanged

- [X] T005 [US3] In `test/runtime.test.ts` append selection-error tests (record `fake.clones`, `fake.creates`, and `snapshot()` before each case; all unchanged after):
  - `run('x', { template: 'nope' })` rejects `TypeError` (not `TaskError`) while a held task is running
  - `runtime.stream('x', { template: 'nope' })` creation does nothing; its first `next()` rejects `TypeError`; `stream.timing` stays `undefined`
  - named-only runtime (templates, no `session`): `run('x')` rejects `TypeError`; `stream('x')` first pull rejects `TypeError`; neither enters the queue or takes a slot (snapshot `active`/`queued` and `fake.clones` unchanged)
  - no automatic selection: named-only runtime, `run('x')` never clones any template (FR-307, FR-313, SC-304)

---

## Phase 5: User Story 4 - Existing single-session usage keeps working (Priority: P2)

**Goal**: 001–003 behavior unchanged; default template rules

**Independent Test**: existing calls behave as before; `session` + templates routes unnamed tasks to the default

- [X] T006 [US4] In `test/runtime.test.ts` append compatibility tests:
  - `createRuntime()` → `fake.creates === 1`, one base; `run('x')` and `run('x', { signal })` (abort mid-prompt → `'cancelled'`) behave as in 001
  - `createRuntime({ session })` → `fake.createArgs[0] === session` (same object), one base
  - `createRuntime({ session: { initialPrompts: ['default'] }, templates: { risk: { initialPrompts: ['risk'] } } })` → 2 bases; `run('a')` clones the default (`['default', 'a']`), `run('b', { template: 'risk' })` clones risk (`['risk', 'b']`); `collect(stream('c'))` uses the default
  - `createRuntime({ templates: {} })` rejects `TypeError` and `fake.creates === 0` (FR-308)
  - `createRuntime({ session, templates: {} })` → exactly one base, behaves like single-session (FR-308)

---

## Phase 6: User Story 5 - Deterministic lifecycle for all bases (Priority: P2)

**Goal**: Creation rollback, runtime-wide broken, shutdown of every base

**Independent Test**: 3 templates → shutdown destroys each base exactly once; failed creation leaves no live base

- [X] T007 [US5] In `test/runtime.test.ts` append creation-rollback tests, wrapping `LanguageModel.create` inside the test so the Nth call rejects with a specific error (the shared fake is not modified):
  - templates a, b, c with the 3rd `create()` rejecting `err` → `createRuntime` rejects with exactly `err` (identity); the first two bases are destroyed exactly once (`fake.destroys` delta 2, `fake.live === 0`); no runtime is returned
  - same with `session` + templates: the default and the created templates are all destroyed
  - with `fake.destroyThrows = true` during rollback: every created base is still destroyed (`fake.live === 0`) and the original `err` is still what rejects (FR-309)
- [X] T008 [US5] In `test/runtime.test.ts` append runtime-wide broken tests (FR-311):
  - `limit: 2, queueCapacity: 2`, templates a and b: held task on b (own clone), then a task on a whose clone rejects `InvalidStateError` → it rejects `'broken'`; `runtime.state === 'broken'`; a task queued on b before the transition rejects `'broken'`; a new task on b and a new task on a reject `'broken'` without cloning; `snapshot()` equals `{ state: 'broken', active: 1, queued: 0, limit: 2, queueCapacity: 2 }`
  - release the held b task → it completes successfully; `fake.creates` unchanged (no recovery)
- [X] T009 [US5] In `test/runtime.test.ts` append shutdown tests (FR-310, SC-305):
  - `session` + templates a, b: run a task on each, `await shutdown()` → `fake.destroys` delta equals clones + 3 bases, every base `destroyed === true`, `fake.live === 0`
  - named-only runtime with 3 templates → all 3 bases destroyed once
  - `fake.destroyThrows = true` → shutdown still resolves and every base is `destroyed`
  - `Promise.all([shutdown(), shutdown()])` and a later `shutdown()` return the same promise; `fake.destroys` does not grow after the first completion
  - a held task on template a during shutdown → rejects `'cancelled'`; in the first `fake.onDestroy` call no base is destroyed yet (`fake.sessions.filter(s => s.isBase).every(b => !b.destroyed)`), i.e. the clone is destroyed before any base

**Checkpoint**: all stories pass → MVP complete (T001–T009)

---

## Phase 7: Polish & Validation

- [X] T010 In `test/runtime.test.ts` append SC-303 mixed validation: `limit: 2, queueCapacity: 4`, templates a/b/c, 100 tasks mixing `run` and `stream` round-robin across templates (fake steps resolve after a tick; a few aborted); after submission and on every settle `snapshot()` has exactly the 5 keys, `active ≤ 2`, `queued ≤ 4`; all settle as success, `'rejected'`, or `'cancelled'`; ends at `active: 0, queued: 0`. Not a benchmark; no timing assertions
- [X] T011 [P] In `README.md` add a short "Templates" section: `templates` option, `{ template }` per task for `run`/`stream`, default template rules (session present → default; templates only → must name one, else `TypeError`), shared limit/queue, runtime-wide broken, shutdown destroys all bases
- [X] T012 Final verification (traceability: SC-303's mixed-template admission/FIFO ordering is verified deterministically by T004; T010 verifies global concurrency/queue bounds and full settlement under the 100-task mixed-template stress and need not re-check FIFO order): `npm test` all pass with the 76 existing tests unmodified (no removed/changed lines in the existing part of `test/runtime.test.ts`); `npx tsc --noEmit -p .` and `npm run build` pass; `dist/index.d.ts` has no new exported names (only `templates` on `RuntimeOptions` and `template` in the two options types); `package.json` has no `dependencies`; `git diff src/index.ts` shows no changes inside `admit`, `release`, `drain`, `end`, `failure`, or `snapshot`

---

## Dependencies & Execution Order

- T001 → T002 → US1 (T003) → US2 (T004) → US3 (T005) → US4 (T006) → US5 (T007–T009) → Polish (T010–T012)
- T011 (README) is the only `[P]` task; it can run anytime after T002
- All story phases verify T002; none adds production code

## Implementation Strategy

**MVP = T001–T009.** T002 is the entire production change; US1–US5 prove selection, isolation,
shared scheduling, error-free-of-side-effects selection, compatibility, rollback, broken, and
shutdown. Polish adds the mixed-load bound check, docs, and the final API and diff check.

## Notes

- No new bookkeeping beyond the fixed `bases` Map; no template health/state, metrics, or registry API
- Public API delta: `RuntimeOptions.templates`, `template` option on `run` and `stream`
