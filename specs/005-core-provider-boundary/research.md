# Research: Core / Browser Provider Boundary

Builds on 001 (R1–R9), 002 (S1–S7), 003 (P1–P5), 004 (T1–T6). Decisions follow the spec
Clarifications (source-level boundary, provider as first argument, internal contract).

## B1. Inventory: policy vs mechanism in today's `src/index.ts`

Every browser-native touch point in the current file:

| Line(s) today | What | Owner after 005 |
|---|---|---|
| `interface Session { clone; prompt; promptStreaming; destroy }` | shape the runtime calls | **core** (internal contract, renamed nowhere) |
| `declare const LanguageModel: { create(options?: object): Promise<Session> }` | the browser global | **browser** |
| `bases.set(undefined, await LanguageModel.create(session))` | default base creation | **core** policy, call becomes `provider.create(session)` |
| `bases.set(name, await LanguageModel.create(config))` | template base creation | **core** policy, call becomes `provider.create(config)` |
| `base.clone({ signal: sig })` in `acquire` | clone | **core** (already provider-neutral: calls the contract) |
| `task.prompt(input, { signal: sig })` in `run` | prompt | **core** |
| `task.promptStreaming(input, { signal: sig })` in `stream` | streaming prompt | **core** |
| `task?.destroy()` in `end`, `b.destroy()` in rollback and `shutdown` | destroy | **core** |
| `e instanceof DOMException && e.name === 'InvalidStateError'` | broken detection | **core**, unchanged (see B4) |
| `new DOMException('Runtime closed', 'AbortError')` | shutdown abort reason | **core**, unchanged (see B4) |
| doc comments mentioning `LanguageModel.create()` on `RuntimeOptions` | docs | **core**, reworded to "the session provider's create()" |
| header comment "Minimal shape of Chrome's Prompt API" | docs | reworded |

Result: exactly **two call sites** and **one declaration** are browser-bound. Everything else
already talks to the `Session` shape, so the extraction is a move plus two call-site edits.

## B2. Internal contract

- **Decision**: the existing `Session` interface, unchanged, plus one provider interface:

  ```ts
  export interface SessionProvider { create(config?: object): Promise<Session> }
  ```

  Both live in `src/core/runtime.ts`, exported from that module (so the browser area can import
  them) but **not** re-exported from `src/index.ts`.
- **Rationale**: derived only from operations the runtime already performs (B1). `destroy()` stays
  synchronous (spec Assumption; `end()` relies on destroy → release → total in one turn).
  `clone` keeps `{ signal? }` because `acquire` already passes it. Config stays `object`, as
  `RuntimeOptions.session` / `templates` are typed today.
- **Alternatives rejected**: generic `SessionProvider<Config>` (one provider, one config type;
  add the type parameter in 006 if a second provider's config differs); a separate
  `provider.ts` file (two interfaces, one consumer; see B5); `destroy(): void | Promise<void>`
  (would change cleanup ordering, out of scope).

## B3. Browser adapter

- **Decision**: in `src/browser/runtime.ts`:

  ```ts
  declare const LanguageModel: SessionProvider;
  const promptApi: SessionProvider = { create: (config) => LanguageModel.create(config) };
  export function createRuntime(options?: RuntimeOptions): Promise<Runtime> {
    return createCoreRuntime(promptApi, options);
  }
  ```

- **Why `create` is wrapped but sessions are not**:
  - The global is read **lazily**, inside `create`. Passing `LanguageModel` directly would read
    the global when `createRuntime` is called, before option validation. Where the global is
    absent this would throw a `ReferenceError` before a `TypeError` for bad options and, because
    `createRuntime` itself is not `async`, synchronously instead of as a rejection. The wrapper keeps today's
    order: validation `TypeError`s first, then the `create()` call fails inside the async
    `createCoreRuntime`, which rejects. `createCoreRuntime` is `async`, so any throw becomes a
    rejection as today.
  - Native sessions already have exactly `clone / prompt / promptStreaming / destroy` with
    `{ signal }` options, so the mapping for these four is identity. Wrapping them would add a
    per-call hop and `this`-binding risk for zero behavior (Principle IV). The adapter returns
    the native session object itself.
- `createRuntime` stays a `function` declaration with the 004 signature
  `(options?: RuntimeOptions): Promise<Runtime>`, so the emitted declaration keeps the 004 form
  (`declare function`), not `declare const`.
- **Alternatives rejected**: a `BrowserProvider` class; per-method session wrappers;
  availability checks (not needed by existing behavior; spec scope exclusion).
- **Ceiling**: the native API's type is our own `SessionProvider` declaration, as it was before
  (001 R1). Real conformance is checked by the smoke test, not by the type checker.

## B4. Error semantics and web-platform globals in core

- **Decision**: keep the broken check byte-identical:
  `!sig.aborted && e instanceof DOMException && e.name === 'InvalidStateError'`. Keep
  `new DOMException('Runtime closed', 'AbortError')`.
- **Rationale**: `DOMException`, `AbortController`, `AbortSignal.any`, and `performance.now()`
  are web-platform globals that also exist in Node ≥ 17; they are not browser-AI APIs and do not
  make core browser-dependent (FR-404 forbids the AI global, `window`, and availability APIs).
  Keeping the `instanceof` guard is a zero behavior change (FR-407) and matches the spec
  Assumption: `DOMException` + name `InvalidStateError`, exactly as today; no browser-AI error
  type is referenced. Generalizing is deferred to 006, only if a second provider needs it.
- **Alternatives rejected**: name-only check (would make a non-`DOMException` error named
  `InvalidStateError` break the runtime; a behavior change); a `ProviderError` hierarchy.

## B5. Source layout

- **Decision**: three files.

  ```text
  src/core/runtime.ts      # everything in today's index.ts except the global; exports the
                           # public types, TaskError, SessionProvider, Session, createCoreRuntime
  src/browser/runtime.ts   # LanguageModel declaration, promptApi, public createRuntime
  src/index.ts             # public surface: re-exports exactly the 004 names
  ```

- **Rationale**: the smallest layout that has a core area and a browser area (Clarification
  Q1). `git mv src/index.ts src/core/runtime.ts` keeps history for the moved code.
- **Alternatives rejected**: `core/provider.ts` and `browser/provider.ts` (splits ~6 lines into
  their own files with a single consumer); making `src/index.ts` the browser file (no browser
  area to move into `@akarisp/browser` later).

## B6. Core factory name and signature

- **Decision**: `createCoreRuntime(provider: SessionProvider, options: RuntimeOptions = {}):
  Promise<Runtime>`. Body identical to today's `createRuntime` except the two `create` calls.
- **Rationale**: distinct name avoids two different `createRuntime` functions in grep results
  and stack traces; provider first (Clarification Q2); `RuntimeOptions` reused unchanged.

## B7. Imports and build

- **Decision**: relative imports use the `.ts` extension (required by Node's type stripping,
  which the tests use); add `"rewriteRelativeImportExtensions": true` to `tsconfig.json` so `tsc`
  emits `.js` specifiers. Type re-exports use `export type { … }` (type stripping removes them;
  a plain `export { RuntimeOptions }` would fail at runtime).
- **Verified** (scratch experiment with TS 5.9.3 / Node 23.9): emitted `dist/index.js`
  re-exports `./browser/runtime.js` and `./core/runtime.js`; emitted `.d.ts` keeps `.ts`
  specifiers and a consumer project type-checks against it under both `bundler` and `nodenext`
  resolution; runtime keys of the built entry are exactly the value exports.
- `package.json` `exports` stays `{ ".": dist/index }`, so `dist/core/*` and `dist/browser/*`
  are not importable by consumers: the contract stays internal at the package level too.

## B8. Boundary enforcement

- **Decision**: one test file, `test/boundary.test.ts`, no new tools:
  1. **Static**: read every `.ts` file under `src/core/`, strip comments, then fail on the
     whole-word tokens `LanguageModel`, `window`, `globalThis`, `navigator`, `self`, `document` (regex
     `/\b(LanguageModel|window|globalThis|navigator|self|document)\b/`), or on a static or
     dynamic import of the browser area (`/(from|import\()\s*['"][^'"]*browser/`).
  2. **Import**: define a throwing getter on `globalThis.LanguageModel` (counts reads), then
     `await import('../src/core/runtime.ts')`; assert the import succeeds, 0 reads, and nothing
     else happens. Node runs each test file in its own process, so the module is not already
     cached by another test file.
  3. **Public exports**: `Object.keys(await import('../src/index.ts'))` sorted equals
     `['TaskError', 'createRuntime']` (004's value exports).
- Type-level API is checked in final verification (T010) against the baseline commit, in two
  parts, without new dependencies:
  - **names**: the exported names parsed from `dist/index.d.ts` are exactly `createRuntime,
    TaskError, RuntimeOptions, Runtime, RuntimeSnapshot, TaskStream, TaskResult, TaskTiming`
    (catches type-only additions such as `Session`, which a value-key check cannot see);
  - **shapes**: a throwaway compile-time fixture (scratch, not committed) imports the 004
    source (`git show $BASE:src/index.ts`) as `Old` and the new `src/index.ts` as `New` and
    asserts type identity with `Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T
    extends B ? 1 : 2) ? true : false` for `keyof typeof` (value exports), `typeof
    createRuntime`, `typeof TaskError`, `TaskError`, and the six public types. Doc comments do
    not affect it. Prototyped in scratch: passes for the planned split; fails for a changed
    field type (`limit?: number | string`), a required `options` parameter, an added value
    export, and an added `TaskStream` member.
- **Alternatives rejected**: ESLint `no-restricted-imports` (new dev dependency and config);
  a separate `tsconfig` for core without the DOM lib (core legitimately uses `AbortSignal`,
  `DOMException`, `performance`, which come from DOM lib typings here).

## B9. Test migration

- **Decision**: `test/runtime.test.ts` becomes the core suite by changing only its harness:
  - import `createCoreRuntime` and `TaskError` from `../src/core/runtime.ts`;
  - the `beforeEach` fake object is assigned to a module-level `provider` instead of
    `globalThis.LanguageModel`;
  - one line `const createRuntime = (options?: RuntimeOptions) => createCoreRuntime(provider, options);`
    so the 98 existing `createRuntime(...)` call sites and every assertion stay byte-identical;
  - the one test that wraps `LanguageModel.create` (004 rollback) wraps `provider.create`.
- **Gate order** (see plan): the suite first runs **unmodified** against the extracted code
  through the public browser entry (proves identical end-to-end behavior), then the harness is
  retargeted to core and must still pass 89/89 with no assertion lines changed.
- **Browser adapter tests** (`test/browser.test.ts`, new, small). They verify only what
  `src/browser/runtime.ts` owns; no session wrapper is added to make them possible:
  - **import without the global**: with a counting getter installed on
    `globalThis.LanguageModel` that throws, importing `../src/index.ts` succeeds with 0 reads;
  - **lazy global read**: `createRuntime({ limit: 0 })` rejects `TypeError` with 0 reads (the
    global is read only when a base is actually created); with the global absent,
    `createRuntime()` rejects `ReferenceError` (today's behavior);
  - **create delegation + config identity**: with a recording fake global,
    `createRuntime({ session, templates: { a } })` calls native `create` with exactly `session`
    then `a` (same objects);
  - **native session pass-through + entry wiring**: one `run('x')` through the public
    `createRuntime` completes and its output is produced by the native session object that
    native `create` returned (the fake's `clone` records `this`), proving the public entry
    connects the browser provider to the core and the core uses native sessions as returned.
  Clone / prompt / promptStreaming / signal propagation / destroy / cancellation / streaming /
  templates / broken / shutdown stay in the core suite (FR-412).
