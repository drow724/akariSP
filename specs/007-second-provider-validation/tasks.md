---

description: "Task list for 007-second-provider-validation"
---

# Tasks: Second Provider Validation (WebLLM)

**Input**: Design documents from `/specs/007-second-provider-validation/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D8), data-model.md,
contracts/internal-provider.md, quickstart.md; 006 merged; research evidence in
`experiments/webllm/`

**Tests**: Included. Order enforces "core + Chrome stable on the new contract first, WebLLM
after", so a WebLLM failure is attributable to the adapter, not the core contract.

**Invariant for optional provider operations** (applies to every task):

```text
provider operation absent  ≠  cleanup skipped accidentally
provider operation absent  =  that provider owns no resource at that lifecycle level
```

Chrome has no `close()` because it owns no provider-wide resource. WebLLM has no
`destroy(base)` because a template config owns no resource. Every provider implementation and
every test states which level it owns. No implementation defines an operation as a no-op to
look symmetric.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: spec user stories:
  - US1: core without the Chrome model
  - US2: ordered async shutdown
  - US3: task-local cancellation
  - US4: provider-specific broken
  - US5: templates on both providers
  - US6: evidence and real browsers

---

## Phase 1: Setup — baseline

- [X] T001 Record the baseline before any edit:
  - `BASE=$(git rev-parse HEAD)`
  - `npm test` → 105/105; `npx tsc --noEmit -p .` clean; `npm run build` OK;
    `npm run test:browser` → 21/21
  - `package.json` has no `dependencies`
  - Note: `experiments/` is untracked (research evidence, committed with this feature), and
    `CLAUDE.md` was modified by the user (not part of this feature; do not edit)

---

## Phase 2: Foundational — new contract, core migration, Chrome adaptation (blocks all stories)

- [X] T002 In `src/core/runtime.ts`, change only the types (research D2 /
  contracts/internal-provider.md):
  - `Session`:
    - remove `clone`
    - `prompt(input: Prompt, options: { signal: AbortSignal }): Promise<string>`
    - `promptStreaming(input: Prompt, options: { signal: AbortSignal }): AsyncIterable<string>`
    - `destroy(): void | Promise<void>`
  - `export interface SessionProvider<B>` with:
    - `create(config?: object): Promise<B>`
    - `start(base: B, options: { signal: AbortSignal }): Promise<Session>`
    - `broken(error: unknown): boolean`
    - `destroy?(base: B): void | Promise<void>`: per-template resource
    - `close?(): void | Promise<void>`: provider-wide resource
  - `createCoreRuntime<B>(provider: SessionProvider<B>, options: RuntimeOptions = {})`;
    `bases: Map<string | undefined, B>`
  - Run `npx tsc --noEmit -p .` and record the expected errors: `acquire` (clone), rollback and
    shutdown (`b.destroy`), and `src/browser/runtime.ts`. Change no logic yet.
- [X] T003 In `src/core/runtime.ts`, migrate the lifecycle (research D7). Change nothing else:
  - `acquire(base, sig, timing)`:
    - `task = await provider.start(base, { signal: sig })`
    - broken check becomes `!sig.aborted && provider.broken(e)` (same branch, same drain,
      same `TaskError('broken', timing, e)`)
    - remove the `InvalidStateError` ponytail comment (moves to the browser module in T004)
  - `end` becomes `async (task, t0, timing)`:
    `try { await task?.destroy(); } catch {}` → `release()` → `timing.total = …`
  - `run`: `finally { await end(task, t0, timing); }`
  - stream single-flight cleanup: `await end(task, t0, timing)` (same place)
  - creation rollback: `for (const b of bases.values()) try { await provider.destroy?.(b); } catch {}`
    then `throw e` (original error). **No `close()` in rollback**: ownership of provider-wide
    resources is never taken when creation fails.
  - `shutdown`, after the idle gate:
    `for (const b of bases.values()) try { await provider.destroy?.(b); } catch {}`
    then `try { await provider.close?.(); } catch {}`, then resolve
  - doc comments on `RuntimeOptions.limit`, `Runtime.run`, `Runtime.stream`,
    `RuntimeSnapshot.active`: "clone" → "task session" wording only
  - do not touch validation, `pick`, `admit`, `release`, `drain`, `failure`, `snapshot`,
    `closing`/`idle`, or the TaskError/TaskTiming shapes
- [X] T004 In `src/browser/runtime.ts`, adapt Chrome with no wrapper (research D3):
  - `interface NativeSession extends Session { clone(options?: { signal?: AbortSignal }): Promise<NativeSession>; }`
  - `declare const LanguageModel: { create(options?: object): Promise<NativeSession> }`
  - `promptApi: SessionProvider<NativeSession>` has:
    - `create: (config) => LanguageModel.create(config)`
    - `start: (base, options) => base.clone(options)`
    - `broken: (e) => e instanceof DOMException && e.name === 'InvalidStateError'`, with the
      moved `ponytail:` comment
    - `destroy: (base) => base.destroy()`
    - no `close`: Chrome owns no provider-wide resource
  - the `createRuntime` signature is unchanged
- [X] T005 Adapt the harness in `test/runtime.test.ts`, keeping every assertion. The
  `beforeEach` provider object gains:
  - `start: (base: FakeSession, options: { signal: AbortSignal }) => base.clone(options)`
  - `broken: (e: unknown) => e instanceof DOMException && e.name === 'InvalidStateError'`
  - `destroy: (base: FakeSession) => base.destroy()`

  `failCreateOn` is unchanged.

  Gate:
  - `npm test` → 105/105, `npx tsc --noEmit -p .` clean, `npm run build`,
    `npm run test:browser` 21/21
  - `git diff $BASE -- test/runtime.test.ts` shows only the provider-object lines
  - if a timing-sensitive test fails (the extra microtask from awaiting Chrome's sync
    `destroy()`), investigate and fix the core; never change or relax an assertion

**Checkpoint**: core and Chrome are stable on the new contract before any WebLLM code exists

---

## Phase 3: User Story 1 - The core no longer assumes Chrome's resource model (P1)

**Independent Test**: a clone-less provider runs the full lifecycle; broken is delegated

- [X] T006 [US1] Append tests to `test/runtime.test.ts` using a request-style fake provider
  defined in the test:
  - Provider shape:
    - `create(config) → config` (base = config object)
    - `start(base, { signal })` returns
      `{ prompt, promptStreaming, destroy }`: `prompt` resolves `` `${base.tag}:${input}` ``;
      `promptStreaming` yields 3 chunks and honors `signal`; `destroy` is recorded
    - no `destroy(base)` and no `close()`: this provider owns no resources at those levels
  - Asserts:
    - `run` and `stream` succeed through `createCoreRuntime`
    - `start` receives the exact base object of the selected template (`{ templates: { a, b } }`)
    - caller abort mid-`prompt` → `TaskError('cancelled')`
    - early `break` → the task's `destroy` is called once before the loop exit completes
    - shutdown resolves
    - no object in the test provider or its tasks has a `clone` property
- [X] T007 [US1] Append broken-delegation tests to `test/runtime.test.ts`:
  - a provider whose `start` rejects `err` and `broken(e) === (e === err)`:
    - the task rejects `'broken'` with `cause === err`
    - `state === 'broken'`, a queued task rejects `'broken'`, a later task is rejected without
      calling `start`
  - the same rejection with the task signal already aborted → `'cancelled'`, and `broken` is
    **not consulted** (count calls)
  - `prompt` rejecting `err` (start OK) → `'failed'`, `state === 'ready'`, and `broken` is not
    consulted (the broken stage is start only, research D4)
- [X] T008 [P] [US1] Append Chrome predicate tests to `test/browser.test.ts` through the public
  `createRuntime` with a recording fake global (the native object's `clone` rejects):
  - `new DOMException('gone', 'InvalidStateError')` → `run` rejects code `'broken'`,
    `runtime.state === 'broken'`
  - plain `{ name: 'InvalidStateError' }` → `'failed'`, `state === 'ready'`
  - the existing "native session used unwrapped" test still passes (`start = clone`, no wrapper)

---

## Phase 4: User Story 2 - Shutdown waits for real, ordered provider cleanup (P1)

**Independent Test**: async task cleanup → base cleanup → provider close → resolve

- [X] T009 [US2] Append an ordering test to `test/runtime.test.ts`. The provider has async task
  `destroy` (resolves after 20 ms), async `destroy(base)` (10 ms), and async `close()` (10 ms),
  each pushing `start`/`end` events to a shared log.
  - A held `run` is active, then `shutdown()`.
  - The log order is: task-destroy end → every base-destroy end → close end → shutdown resolved.
  - While the task's async `destroy` is pending, `snapshot().active === 1`, and the `run`
    promise has not settled (cleanup before settle).
- [X] T010 [US2] Append an async rollback test to `test/runtime.test.ts`:
  - `templates: { a, b, c }`; `create(c)` rejects `err`; `destroy(baseB)` rejects
    asynchronously; `destroy(baseA)` resolves asynchronously
  - `createCoreRuntime` rejects with exactly `err`
  - both `destroy` calls happen
  - `close` is called 0 times
- [X] T011 [US2] Append tests to `test/runtime.test.ts`:
  - `Promise.all([shutdown(), shutdown()])` → `close` called exactly once; a later
    `shutdown()` returns the same promise
  - a provider whose `destroy(base)` and `close()` both reject → shutdown still resolves, and
    `close` is still called after a rejecting `destroy(base)`

---

## Phase 5: User Story 3 - WebLLM integration with task-local cancellation (P1)

**Starts only after Phase 2–4 are green.**

- [X] T012 [US3] Create `src/webllm/runtime.ts` (internal, not exported from `src/index.ts`),
  following research D5/D6 and data-model.md:
  - Exports:
    - `interface WebLLMEngine`: the subset of `@mlc-ai/web-llm` 0.2.85 used:
      `chat.completions.create(request): Promise<AsyncIterable<Chunk>>`,
      `interruptGenerate(): Promise<void>`, `getMessage(): Promise<string>`,
      `unload(): Promise<void>`, where `Chunk = { choices: { delta?: { content?: string } }[] }`
    - `async function createWebLLMRuntime(engine, options: RuntimeOptions = {}): Promise<Runtime>`
  - `options.limit !== undefined && options.limit > 1` → `throw new TypeError(...)` before
    anything else. The engine is untouched and ownership is not taken.
  - The provider `SessionProvider<object>` has:
    - `create: async (config = {}) => config`: a template config owns no resource, so there is
      no `destroy(base)`
    - `start: async (base) => { await engine.getMessage(); return task(base); }`: the broken
      probe (research D4)
    - `broken: (e) => e?.name === 'ModelNotLoadedError' || e?.name === 'DeviceLostError'`
    - `close: () => engine.unload()`: the engine is the provider-wide resource
  - `task(base)` builds the request as `{ ...rest, messages: [...initialPrompts, ...userMessages], stream: true }`
    from `const { initialPrompts = [], ...rest } = base`, where `userMessages` is
    `[{ role: 'user', content: input }]` for a string and `input` itself for a message array.
  - `promptStreaming(input, { signal })`:
    - on abort, the listener calls `engine.interruptGenerate()`
    - `it = (await engine.chat.completions.create(req))[Symbol.asyncIterator]()`
    - loop `while (!signal.aborted) { pulled = true; const r = await it.next(); if (r.done) { done = true; break; } const t = r.value.choices[0]?.delta?.content; if (t) yield t; }`
    - `if (signal.aborted) throw signal.reason` (an interrupted generation ends without an
      error, E8)
    - `finally`: remove the listener
    - **never `for await` over `it` and never call `it.return()`** (E6)
  - `prompt(input, options)`: accumulate `promptStreaming(input, options)`. Always streaming (E5).
  - `destroy()`: single-flight `draining ??= (async () => { ... })()`:
    - if there is no `it` or `done` → return
    - if `!pulled` → `if ((await it.next()).done) return;` (0.2.85 resets the interrupt flag on
      the first `next()`)
    - `await engine.interruptGenerate()`
    - `while (!(await it.next()).done);`
    - `done = true`
  - `ponytail:` comments on:
    - the manual `next()`: the 0.2.85 lock leaks on `return()`; switch to `return()` once a
      release frees the lock in `finally`
    - the first-`next()` before interrupt: costs up to one time-to-first-token
  - Doc comment on `createWebLLMRuntime` states the ownership rule: exclusive use after a
    successful creation, unload at shutdown, untouched on failed creation. It also states that
    this is internal until 008.
- [X] T013 [US3] Create `test/webllm.test.ts` with an in-test fake engine that reproduces the
  observed v0.2.85 behavior.
  - Fake engine behavior:
    - `chat.completions.create({ stream: true })` awaits a FIFO lock and returns an iterator
      object with counted `next` and `return` over an async generator.
    - When the generator starts (first `next`), it resets the interrupt flag, then awaits an
      optional **first-token gate**: a deferred the test releases. It does not use a wall-clock
      sleep. It then yields N chunks with a tick between them.
    - When the flag is set, it stops and yields a final `finish_reason: 'abort'` chunk.
    - It releases the lock **only after its last statement**, so a leaked `return()` keeps the
      lock forever.
    - `create({ stream: false })` throws `Error('non-streaming path used')`.
    - `interruptGenerate` sets the flag.
    - `getMessage` throws an error named `ModelNotLoadedError` after `unload`.
    - `unload` is async (10 ms) and counted.
    - The fake records the messages of each request and the maximum number of requests in
      flight.
  - Tests:
    - `createWebLLMRuntime(engine, { limit: 2 })` rejects `TypeError`, and `unload` is not
      called.
    - Two concurrent `run`s: max in-flight 1, `snapshot` shows `active: 1, queued: 1`, and both
      complete (E3).
    - A running and B queued; abort B → B rejects `'cancelled'`, A's output is complete (all
      chunks), and B's request never reaches the engine (E4).
    - Abort A mid-stream → `'cancelled'`; the next `run` returns non-empty output (E5, E6b).
    - `stream` early `break` after 1 chunk → the next `run` completes; the iterator's `return`
      count is 0 (E6).
    - `run` never calls the non-streaming path (the fake would throw).
    - First-token cleanup, deterministic via the gate (no real 200 ms wait). Each case must
      end with the lock released, the next task executing, and 0 native `return()` calls. The
      gate is released by the test after the cancellation is injected, so cleanup can finish.
      - (a) **before the first `next()`**: abort while `create()` is still pending, so the
        adapter never pulls. `destroy` must take the "first `next()` then interrupt then drain"
        branch. Assert the fake saw the interrupt only after its first-`next()` reset.
      - (b) **while waiting for the first token**: the first `next()` is pending on the gate.
        Cover caller abort, `AbortSignal.timeout(5)`, and `shutdown()`. `destroy`
        interrupts, then drains.
    - Paused consumer: `stream` yields 1 chunk, the consumer stops pulling, then abort.
      - The core's abort listener runs `end` → `destroy`, which drains while the adapter
        generator is suspended at `yield`.
      - The slot is released: a next `run` is admitted and completes.
      - A later pull of the stream rejects `'cancelled'`.
      - The adapter's `finally` only removes its listener and never touches the native iterator.
      - 0 native `return()` calls.
    - `shutdown` with an active stream: drain completes before `unload` starts (event order),
      `unload` is called exactly once, and shutdown resolves after it (E7, E7b).
    - The session objects returned by `start` have no `clone` property (FR-603).

---

## Phase 6: User Story 4 - Broken state is decided by the provider (P2)

- [X] T014 [US4] Append to `test/webllm.test.ts`:
  - `unload` the fake engine behind the runtime's back, then `run` → rejects `'broken'` with
    `cause.name === 'ModelNotLoadedError'`; `state === 'broken'`; queued and later tasks are
    rejected `'broken'`
  - a stream error named `NonNegativeError` → `'failed'`, `state === 'ready'`
  - a mid-generation error named `DeviceLostError` → `'failed'`, `state === 'ready'` (007 does
    not promote execution-stage failures; research D4). The next `start` succeeds or fails
    according to `getMessage`.

---

## Phase 7: User Story 5 - Templates keep their meaning on both providers (P2)

- [X] T015 [US5] Append to `test/webllm.test.ts`:
  - `templates: { risk: { initialPrompts: [sysR], temperature: 0 }, default: { initialPrompts: [sysD] } }`
  - alternating `run`s → each recorded request's `messages` starts with only its own system
    message and carries its own settings
  - `getMessage`/request calls go to the single engine
  - an unknown template → `TypeError` with no request recorded

  Chrome template behavior stays covered by the unchanged 004 tests.

---

## Phase 8: Boundary / architecture (cross-cutting)

- [X] T016 Update `test/boundary.test.ts`. Express each architecture invariant as its own test.
  Every static check runs on core code with comments stripped, so docs never match.
  1. **No clone dependency in the core**: no `.clone(` call and no `clone` member in the core's
     `Session` interface.
  2. **No provider error vocabulary in the core's broken decision**: no `InvalidStateError` in
     core code. `DOMException` is allowed only in the shutdown abort reason,
     `new DOMException('Runtime closed', 'AbortError')`.
  3. **Core imports nothing from `browser` or `webllm`**, for static and dynamic imports alike.
  4. **The WebLLM module imports only the core**: `src/webllm/runtime.ts` import specifiers are
     exactly `../core/runtime.ts`, so there is no browser import.
  5. **Root exports unchanged**: the existing value-export check
     (`['TaskError', 'createRuntime']`) is kept.
  6. **Runtime dependencies unchanged**: `package.json` has no `dependencies`.
  - gate: `npm test` all pass

---

## Phase 9: User Story 6 - Real browsers and evidence (P2)

- [X] T017 [P] [US6] Create `smoke/webllm.html` and `smoke/webllm.js` for real WebLLM
  validation. Setup:
  - imports `https://esm.run/@mlc-ai/web-llm@0.2.85` and `../dist/webllm/runtime.js`
  - model `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`
  - a **Load model** button (downloads only on click, then cached)
  - one button per check and Copy JSON
  - JSON includes `recordedAt`, `userAgent`, `webllm`, `model`, `webgpu`, and per-check
    `status` / `detail`
  - templates use `temperature: 0` and a small `max_tokens`

  Checks (FR-615):
  1. Isolation: a marker is given in task A; task B asks for it; B's output does not contain
     the marker (E1).
  2. Clone-less: `run` and `stream` both return non-empty text.
  3. Serialization: two concurrent `run`s show `active: 1, queued: 1`; B starts after A ends;
     `limit: 2` rejects `TypeError`.
  4. Queued cancel: A runs and B is queued with an abort → B `'cancelled'`, A completes.
  5. Active cancel: abort A after 2 chunks → `'cancelled'`; the next `run` is non-empty.
     Then the same with a timeout: `AbortSignal.timeout(~300 ms)` on a long prompt ends
     `'cancelled'`, and the next `run` is non-empty (SC-605 on the real provider).
  6. Early break: `break` after 2 chunks; the next `run` completes within the watchdog.
  7. Shutdown during an active stream resolves. Afterwards `engine.getMessage()` rejects with
     `ModelNotLoadedError`, which proves unload finished first without touching a native
     generation path. The stream ended `'cancelled'`.
  8. Classification:
     - a template with `temperature: -1` → `'failed'`, runtime still `ready`
     - then `await engine.unload()`, then a new runtime on it → `run` rejects `'broken'`
  9. Templates: templates "Reply only with the word APPLE." / "…BANANA.", alternated; each
     output contains its own word.

  Checks 7 and 8 unload the engine; the page asks for **Load model** again (cached). There is
  a 120 s watchdog per check and a stall guard, as in `experiments/webllm/`.
- [X] T018 [P] [US6] Create `experiments/webllm/EVIDENCE.md`: one row per experiment (E1–E9,
  E6b, E7b) with the 9 fields:
  - WebLLM version (0.2.85)
  - source revision (tag `v0.2.85`; research also read `main` `bd46399`)
  - model
  - browser/version (Chrome 152, macOS)
  - WebGPU (present)
  - expected (the source-based prediction)
  - observed (from `results/run1..3`)
  - verdict (confirmed / refuted / inconclusive)
  - contract implication

  Record honestly that E6 was predicted to pass from `main` source and was refuted on 0.2.85
  (the lock is not released in `finally`).
- [X] T019 [US6] Real Chrome (manual, user-run): `npm run build && python3 -m http.server 8080`
  → `smoke/streaming.html?browser=Chrome` → import + 7 lifecycle PASS; save as
  `smoke/results/<date>-macos-chrome<major>.json`.
- [X] T020 [US6] Real WebLLM (manual, user-run): `smoke/webllm.html` → Load model → run the 9
  checks → 9/9 PASS; save as `smoke/results/<date>-macos-chrome<major>-webllm.json`. If a
  check fails:
  - attribute it to the adapter or the core with the tests from Phases 2–7
  - fix it in the attributed layer
  - never weaken the check

---

## Phase 10: Polish & final verification

- [X] T021 [P] Update `smoke/README.md`:
  - a "WebLLM validation (internal, 007)" section covering the page, model, checks, and
    engine-ownership note
  - the matrix rows for the WebLLM run

  Add no README public-API text (internal until 008).
- [X] T022 Final verification:
  - `npm test`: all pass (105 + new); `npx tsc --noEmit -p .`; `npm run build`;
    `npm run test:browser` 21/21
  - public API unchanged: `dist/index.d.ts` exports the same 8 names, and the 006-style
    type-identity check against `$BASE` passes
  - `grep -n clone src/core src/webllm` → none (comments allowed only in `src/browser`)
  - `grep -rn "InvalidStateError\|DOMException" src/core` → only the shutdown `AbortError`
    reason
  - `package.json` `dependencies` absent
  - quickstart vs actual behavior compared
  - research predictions vs observed results reconciled; update research.md / EVIDENCE.md for
    any difference
  - optional-operation invariant: Chrome defines `destroy`, not `close`; WebLLM defines `close`,
    not `destroy`; no no-op implementations

---

## Dependencies & Execution Order

- T001 → T002 → T003 → T004 → T005 (**gate: core + Chrome green**) → US1 (T006, T007, T008[P])
  → US2 (T009 → T010 → T011) → **only then** US3 (T012 → T013) → US4 (T014) → US5 (T015) →
  T016 → US6 (T017[P], T018[P] → T019, T020 user-run) → T021[P] → T022
- `[P]`: T008 (a different file from T006/T007), T017 and T018 (independent files), T021.
- WebLLM work (T012+) never starts before T005–T011 pass, so the core contract is proven
  independently of the adapter.

## Implementation Strategy

**MVP = T001–T016**:
- the contract correction, proven on Chrome and on a clone-less fake;
- ordered async cleanup;
- the WebLLM adapter against a behavior-faithful fake;
- boundary rules.

**Completion** requires US6: real Chrome 7/7 and real WebLLM 9/9, plus the evidence table.

## Notes

- No public API change; runtime dependencies stay 0; no registry, capability, strategy,
  provider queue, or fake clone.
- Existing assertions are never edited; T005 changes only the harness provider object.

## Phase 11: Convergence

- [X] T023 Re-run the real WebLLM validation (`smoke/webllm.html`, 9 checks) on the final code, because the recorded run predates the review change to `destroy()` in `src/webllm/runtime.ts` (single-flight guard removed); save the JSON under `smoke/results/` per SC-603 (partial)
- [X] T024 Align `specs/007-second-provider-validation/data-model.md` (WebLLM `Session.destroy()` row) with the implemented `destroy()`: called once per task by the core's `end()`, no single-flight guard per plan: WebLLM lifecycle (contradicts)
