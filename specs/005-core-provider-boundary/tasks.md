---

description: "Task list for 005-core-provider-boundary"
---

# Tasks: Core / Browser Provider Boundary

**Input**: Design documents from `/specs/005-core-provider-boundary/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/public-api.md,
quickstart.md; features 001–004 implemented (89 tests)

**Tests**: Included (spec FR-412, SC-401–SC-405, SC-407). Order follows the staged gates A–G
from the plan: each gate must be green before the next task starts.

**Organization**: Architecture extraction. The only new production abstraction is the internal
`SessionProvider` interface (plus the unexported one-method `promptApi` object that implements
it). No provider registry or manager, adapter factory, session wrapper, browser detection layer,
or capability system. Policy code is moved with `git mv` and not rewritten.

**Baseline ref**: local `main` is stale (points at the initial commit). All "unchanged" checks
compare against `$BASE`, the commit recorded in T001 (the 004 merge, `90a63e8` at planning time).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 browser users keep the same experience · US2 core is provider-neutral ·
  US3 browser integration is a thin mechanism

---

## Phase 1: Setup — Gate A (baseline)

- [X] T001 Regression baseline before any production edit:
  - record `BASE=$(git rev-parse HEAD)` and confirm `git status --porcelain src test package.json tsconfig.json`
    is empty (the baseline source is exactly `$BASE`)
  - `npm test` → 89/89 pass with `test/runtime.test.ts` unmodified
  - `npx tsc --noEmit -p .` clean; `npm run build` succeeds
  - record the 004 public API baseline:
    - names: `grep -E '^export' dist/index.d.ts` → exactly `createRuntime`, `TaskError`,
      `RuntimeOptions`, `Runtime`, `RuntimeSnapshot`, `TaskStream`, `TaskResult`, `TaskTiming`
    - declaration form: `export declare function createRuntime(options?: RuntimeOptions): Promise<Runtime>;`
    - shapes: the source of truth for T010's type-identity fixture is `git show $BASE:src/index.ts`
  - note: in the current code, `createRuntime` validates `limit`, then `queueCapacity`, then
    empty `templates` (each a `TypeError`) before the first `LanguageModel.create` call, all
    inside an `async` function, so they are rejections. This ordering must hold after every gate.
  - no production edit happens until this task passes

---

## Phase 2: Foundational — Gates B and C (contract + move)

**Blocks all user stories.** Existing tests stay unmodified in this phase.

- [X] T002 Gate B — introduce the internal contract in place, in `src/index.ts` (no file move yet).
  **Transitional state**: this step exists only to make the later `git mv` a pure move. While
  it lasts, core/internal symbols (`Session`, `SessionProvider`, `createCoreRuntime`) are
  exported from the current root module; that is **not** the final public architecture. T008
  narrows the root back to the exact 004 public surface.
  - change `interface Session` to `export interface Session` (members unchanged, `destroy(): void`
    stays synchronous)
  - add `export interface SessionProvider { create(config?: object): Promise<Session>; }` right
    after `Session`
  - rename `export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime>`
    to `export async function createCoreRuntime(provider: SessionProvider, options: RuntimeOptions = {}): Promise<Runtime>`
  - replace exactly the two calls `LanguageModel.create(session)` and
    `LanguageModel.create(config)` with `provider.create(session)` and `provider.create(config)`;
    nothing else in the body changes (validation order, default-first then key-order creation,
    rollback with swallowed destroy errors, original error rethrown, `pick`, `admit`, `release`,
    `drain`, `acquire`, `end`, `failure`, `run`, `stream`, `snapshot`, `shutdown`)
  - keep `!sig.aborted && e instanceof DOMException && e.name === 'InvalidStateError'` byte-identical;
    do not generalize to a name-only check
  - change `declare const LanguageModel: { create(options?: object): Promise<Session> };` to
    `declare const LanguageModel: SessionProvider;`
  - append at the end of the file (004 declaration form; not an arrow `const`):
    ```ts
    const promptApi: SessionProvider = { create: (config) => LanguageModel.create(config) };

    export function createRuntime(options?: RuntimeOptions): Promise<Runtime> {
      return createCoreRuntime(promptApi, options);
    }
    ```
    (reads the global only inside `create`; no session wrapper)
  - gate: `npm test` 89/89 with `test/runtime.test.ts` unmodified; `npx tsc --noEmit -p .` clean
- [X] T003 Gate C (part 1) — move the policy to core with history:
  - `git mv src/index.ts src/core/runtime.ts`
  - in `src/core/runtime.ts`, cut the browser lines (`declare const LanguageModel`,
    `const promptApi`, and the `createRuntime` function) and put them in a new `src/index.ts`
    with `import { createCoreRuntime, type Runtime, type RuntimeOptions, type SessionProvider } from './core/runtime.ts';`
    and a temporary `export * from './core/runtime.ts';` (still transitional; narrowed in T008)
  - in `src/core/runtime.ts` reword the comments that name the browser API, without changing
    code: header comment → `// Internal session contract the core runtime calls. Not public; see
    specs/005 research B2.`; `RuntimeOptions.session` doc → "Passed unchanged to the session
    provider's create() for the unnamed default template."; `RuntimeOptions.templates` doc →
    "name → options passed unchanged to the session provider's create()"
  - run `npx tsc --noEmit -p .`; if it fails with TS5097 (import path ending in `.ts`), add
    `"rewriteRelativeImportExtensions": true` to `compilerOptions` in `tsconfig.json` (research
    B7) and rerun; do not add the flag if `tsc` and `npm run build` pass without it
  - gate: `npm test` 89/89 with `test/runtime.test.ts` still unmodified (now exercising
    `src/index.ts` → `src/core/runtime.ts`); `tsc` clean; `npm run build` succeeds

**Checkpoint**: policy lives in `src/core/runtime.ts`; all 89 tests still pass unmodified

---

## Phase 3: User Story 2 - Core is provider-neutral (Priority: P1) — Gate C (part 2)

**Goal**: all 001–004 policy tests run against the core with a fake provider

**Independent Test**: `test/runtime.test.ts` passes importing only `src/core/runtime.ts`

- [X] T004 [US2] Retarget the existing suite to the core in `test/runtime.test.ts` by changing
  harness lines only:
  - import: `import { createCoreRuntime, TaskError, type RuntimeOptions } from '../src/core/runtime.ts';`
  - add `let provider: any;` next to `let fake`, and in `beforeEach` replace
    `(globalThis as any).LanguageModel = {` with `provider = {` (the fake's `create` body unchanged)
  - add one line after the fake setup:
    `const createRuntime = (options?: RuntimeOptions) => createCoreRuntime(provider, options);`
  - in `failCreateOn`, replace both `(globalThis as any).LanguageModel.create` with `provider.create`
  - update the header comment "Fake LanguageModel" → "Fake session provider"
  - no scenario or assertion line changes; the 98 `createRuntime(...)` call sites stay as is
  - gate: `npm test` 89/89; `git diff $BASE -- test/runtime.test.ts` shows only the lines above
- [X] T005 [US2] Append one regression test to the 001 broken section of `test/runtime.test.ts`
  that pins the existing broken condition (`!sig.aborted && e instanceof DOMException &&
  e.name === 'InvalidStateError'`); not new behavior:
  - `failNextClone({ name: 'InvalidStateError' })` (a plain object, not a `DOMException`), then
    `runtime.run('x')` rejects with a `TaskError` whose `code === 'failed'` and whose `cause` is
    that exact object
  - `runtime.state === 'ready'` afterwards, and a following `runtime.run('y')` succeeds (clones
    again; no broken transition, no drain)
  - gate: `npm test` 90/90 (89 existing unchanged + this one)

---

## Phase 4: User Story 3 - Browser integration is a thin mechanism (Priority: P2) — Gate D

**Goal**: the browser area owns only the global, the `create` adapter, and the public entry

**Independent Test**: `test/browser.test.ts` passes; no session wrapper exists in `src/browser/`

- [X] T006 [US3] Create `src/browser/runtime.ts` and move the browser lines out of `src/index.ts`:
  - `src/browser/runtime.ts` contains only:
    ```ts
    import { createCoreRuntime, type Runtime, type RuntimeOptions, type SessionProvider } from '../core/runtime.ts';

    declare const LanguageModel: SessionProvider;
    const promptApi: SessionProvider = { create: (config) => LanguageModel.create(config) };

    /** Create a runtime backed by the browser's built-in Prompt API. The native global is read
     *  only when a base session is created. */
    export function createRuntime(options?: RuntimeOptions): Promise<Runtime> {
      return createCoreRuntime(promptApi, options);
    }
    ```
  - `createRuntime` stays a `function` declaration (004 `.d.ts` form), never `export const`
  - `promptApi` is not exported; native sessions are returned as is (no clone / prompt /
    promptStreaming / destroy wrappers); no class
  - `src/index.ts` becomes `export * from './core/runtime.ts';` plus
    `export { createRuntime } from './browser/runtime.ts';` (still transitional; narrowed in T008)
  - gate: `npm test` all pass; `tsc` clean
- [X] T007 [US3] Add `test/browser.test.ts` (browser-owned responsibilities only; no FIFO, queue,
  concurrency, template policy, streaming lifecycle, broken, or shutdown assertions):
  - helper that installs a getter on `globalThis.LanguageModel` (`configurable: true`) counting
    reads and either throwing a distinct `Error('LanguageModel read')` or returning a given fake;
    `afterEach` deletes the property; all entry imports are dynamic
  1. with the throwing getter: `await import('../src/index.ts')` succeeds and `reads === 0`
     (import without the global; import reads nothing) — first test in the file
  2. with the throwing getter: `createRuntime({ limit: 0 })`, `createRuntime({ queueCapacity: -1 })`,
     and `createRuntime({ templates: {} })` each reject `TypeError`, and `reads === 0`
  3. with the property deleted: `createRuntime()` rejects with a `ReferenceError`
  4. with a recording fake native API (`create(config)` records `config` and returns a fresh
     native object): `createRuntime({ session, templates: { a } })` → recorded configs are
     exactly `[session, a]` by identity (`assert.equal`)
  5. the fake native object's `clone` records `this` and returns a native task object with
     `prompt(input)` returning `native:${input}` and a no-op `destroy()`; `(await createRuntime()).run('x')`
     resolves with `output === 'native:x'` and the recorded `this` is the exact object the fake
     `create` returned (native session used unwrapped; public entry → browser provider → core)
  - gate: `npm test` all pass

---

## Phase 5: User Story 1 - Browser users keep the same experience (Priority: P1) — Gate E

**Goal**: the public surface is exactly 004's

**Independent Test**: public value exports are `createRuntime`, `TaskError`; only the 004 type names

- [X] T008 [US1] Narrow `src/index.ts` to the 004 public surface, replacing the transitional
  `export *`:
  - `export { createRuntime } from './browser/runtime.ts';`
  - `export { TaskError } from './core/runtime.ts';`
  - `export type { RuntimeOptions, Runtime, RuntimeSnapshot, TaskStream, TaskResult, TaskTiming } from './core/runtime.ts';`
  - `SessionProvider`, `Session`, `createCoreRuntime`, `promptApi` are not exported from the root
    (they stay exported from `src/core/runtime.ts` as internal source-level exports, which is
    allowed; `package.json` `exports` exposes only `"."`)
  - final source dependencies must be exactly:
    ```text
    src/index.ts
     ├─> src/browser/runtime.ts
     └─> src/core/runtime.ts   // TaskError and public type re-export

    src/browser/runtime.ts
     └─> src/core/runtime.ts
    ```
    invariants: core → browser = 0, core → `LanguageModel` = 0; `index → core` re-export allowed
  - gate: `npm test` all pass (including `test/browser.test.ts`, which imports the public entry);
    `tsc` clean

---

## Phase 6: User Story 2 - Boundary enforcement (Priority: P1) — Gate F

- [X] T009 [US2] Add `test/boundary.test.ts` (no parser or lint dependency):
  1. **import safety** (first test in the file, dynamic import only): install a getter on
     `globalThis.LanguageModel` that counts reads and throws; `await import('../src/core/runtime.ts')`
     succeeds and `reads === 0`; delete the property afterwards. Not a Node-provider claim.
  2. **static scan**: for every `.ts` file in `src/core/` (`fs.readdirSync`), strip comments
     with `/\/\*[\s\S]*?\*\/|\/\/.*$/gm`, then assert no match for
     `/\b(LanguageModel|window|globalThis|navigator|self|document)\b/` (same token list as
     research B8 and quickstart) and no static or dynamic import of the browser area:
     `/(from|import\()\s*['"][^'"]*browser/`. Scope is `src/core/` only, so tests, fixtures,
     and docs cannot cause false positives
  3. **public value exports**: `Object.keys(await import('../src/index.ts')).sort()` deep-equals
     `['TaskError', 'createRuntime']` (type-only exports are checked in T010)
  - sanity (manual, not committed): temporarily add `LanguageModel;` as a statement in
    `src/core/runtime.ts`, confirm test 2 fails, revert
  - gate: `npm test` all pass

---

## Phase 7: Polish & Validation — Gate G

- [X] T010 Final verification (compare against `$BASE` from T001, never local `main`):
  - **tests**: `npm test` all pass (89 existing + 1 broken pin + browser + boundary);
    `git diff $BASE -- test/runtime.test.ts` shows only T004 harness lines and the T005 appended
    test; no existing scenario or assertion line changed
  - **build**: `npx tsc --noEmit -p .` clean; `npm run build` succeeds
  - **public names** (catches type-only additions a value-key check cannot see): collect the
    names exported by `dist/index.d.ts` (identifiers inside `export { … }` / `export type { … }`
    and after `export declare function|class|interface|type`) → exactly `createRuntime`,
    `TaskError`, `RuntimeOptions`, `Runtime`, `RuntimeSnapshot`, `TaskStream`, `TaskResult`,
    `TaskTiming`; none of `SessionProvider`, `Session`, `createCoreRuntime`, `promptApi`;
    `dist/browser/runtime.d.ts` declares `export declare function createRuntime(options?: RuntimeOptions): Promise<Runtime>;`
    (same form as the T001 baseline); `node -e` import of `dist/index.js` lists only
    `TaskError`, `createRuntime`
  - **public shapes** (compile-time, throwaway, not committed; no new dependency): in the
    session scratch directory, write `old/index.ts` from `git show $BASE:src/index.ts` and a
    `check.ts` that does `import type * as Old from './old/index.ts'` and
    `import type * as New from '<repo>/src/index.ts'`, defines
    `type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false`,
    and assigns `true` to each of: `Eq<keyof typeof Old, keyof typeof New>`,
    `Eq<typeof Old.createRuntime, typeof New.createRuntime>`, `Eq<typeof Old.TaskError, typeof New.TaskError>`,
    `Eq<Old.TaskError, New.TaskError>`, and `Eq<Old.X, New.X>` for `RuntimeOptions`, `Runtime`,
    `RuntimeSnapshot`, `TaskStream`, `TaskResult`, `TaskTiming`. Run
    `tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler --lib ES2022,DOM --allowImportingTsExtensions check.ts`
    → no errors. Doc-comment differences do not affect this check
  - **policy diff** (rewrite detection is required because `src/index.ts` remains as a new
    entry): `git diff $BASE -M -B --stat -- src/` shows `src/index.ts => src/core/runtime.ts`
    as a rename, and `git diff $BASE -M -B -- src/` shows in the moved file only: `export` on
    `Session`, the added `SessionProvider`, the `createRuntime` → `createCoreRuntime(provider, …)`
    signature, the two `provider.create(...)` calls, removal of the `LanguageModel` declaration,
    and the three reworded comments. No change inside `pick`, `admit`, `release`, `drain`,
    `acquire` (the `instanceof DOMException && e.name === 'InvalidStateError'` line identical),
    `end`, `failure`, `run`, `stream`, `snapshot`, `shutdown`, or the rollback block
  - **dependencies**: `grep -rn LanguageModel src/core/` → nothing; no `browser` import in
    `src/core/`; `src/browser/runtime.ts` imports only `../core/runtime.ts`; `src/index.ts`
    imports only `./browser/runtime.ts` and `./core/runtime.ts` (graph in T008)
  - **package**: `git diff $BASE -- package.json` is empty (no `dependencies`, `exports` only
    `"."`, no workspaces); `git ls-files '*package.json'` lists only `package.json`
  - `smoke/streaming.js` and `bench/bench.js` still import `../dist/index.js` (unchanged)
  - no new benchmark or performance claim; README unchanged (no user-facing change)
- [X] T011 Real Chrome smoke (manual, user-run): `npm run build`, `python3 -m http.server 8080`,
  open `http://localhost:8080/smoke/streaming.html`, **Run All** → 5/5 PASS through
  `dist/index.js` → `browser/runtime.js` → `core/runtime.js` (SC-405). The model must already be
  downloaded; the page never starts a download. No change to `smoke/`

---

## Dependencies & Execution Order

- T001 (Gate A) → T002 (B) → T003 (C1) → T004 → T005 US2 (C2) → T006 → T007 US3 (D) →
  T008 US1 (E) → T009 US2 (F) → T010 (G) → T011
- Strictly sequential: every task edits `src/` or `test/runtime.test.ts`, or reruns the whole
  suite as its gate. No `[P]` tasks; parallelism would defeat the stepwise gates.
- Phase order follows the gates, not story priority: US1 (P1) needs the browser entry from US3
  before the public surface can be narrowed.

## Implementation Strategy

**MVP = T001–T010.** After T010 the extraction is complete and verified by automation: core
policy with a fake provider, the pinned broken condition, browser adapter, boundary, public
names and shapes, and the policy diff. T011 is the real-browser confirmation the user runs.

## Notes

- New production abstraction: `SessionProvider` (internal interface) and the unexported
  `promptApi` object that implements it. `Session` is the existing interface, now exported from
  the core module only (internal source-level export, not a root export).
- Runtime dependencies: 0 → 0. Build configuration: at most one `tsconfig.json` flag, only if
  `tsc` needs it (T003).
- Existing runtime-semantics tests are never edited to hide a regression; only T004's harness
  lines change, and T005 appends one pin test.
