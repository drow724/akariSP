---

description: "Task list for 002-streaming-execution"
---

# Tasks: Streaming Task Execution

**Input**: Design documents from `/specs/002-streaming-execution/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/public-api.md,
quickstart.md; feature 001 implemented (`src/index.ts`, `test/runtime.test.ts`)

**Tests**: Included (spec independent tests, SC-102–SC-105, constitution quality gate for
lifecycle/cancellation changes). Tests are written first and must fail before the matching
implementation task.

**Organization**: All code lives in `src/index.ts` and `test/runtime.test.ts` (plan.md
Structure Decision), so tasks are sequential except where noted `[P]`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from spec.md (US1–US4)

---

## Phase 1: Setup

No setup: no new dependencies, files, or configuration (plan.md Technical Context).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Share the 001 lifecycle between `run()` and `stream()` without changing `run()`

**⚠️ CRITICAL**: No user story work can begin until T002 passes

- [X] T001 In `src/index.ts` split the body of `run()` into three closures inside `createRuntime` without changing the order of operations (research S2): `admit(signal)` → `{ t0, timing, sig }` (state check, pre-abort check, slot or queue wait with the existing `leave`/`onAbort` listener cleanup, `queueWait`, `sig = AbortSignal.any([signal, closer.signal])` or `closer.signal`); it sets `timing.total` on every `TaskError` it throws. `acquire(sig, timing)` → session (the "broken while waiting" check, `clone({ signal })`, the existing catch mapping `cancelled` / `InvalidStateError` → `state = 'broken'` + `drain('broken')` + `broken` / `failed`, and `timing.acquire`). `end(task, t0, timing)` (destroy with swallowed errors → `release()` → `timing.total`). Keep the post-clone `if (sig.aborted)` check at the call site after assigning the session. Stop writing `total` inside errors thrown while running (research S5). Rewrite `run()` as `admit` → `try { task = await acquire(...); check; prompt } finally { end(...) }`
- [X] T002 Run `npm test`: all 36 existing tests pass with `test/runtime.test.ts` unchanged, and `npx tsc --noEmit -p .` passes (SC-105 gate)
- [X] T003 In `src/index.ts` add `promptStreaming(input: Prompt, options?: { signal?: AbortSignal }): AsyncIterable<string>` to the local `Session` shape (research S6); add `stream(input: Prompt, options?: { signal?: AbortSignal }): TaskStream` to `Runtime`; export `interface TaskStream extends AsyncIterable<string> { readonly timing: TaskTiming | undefined }` exactly as in `contracts/public-api.md`; add a stub `stream()` whose iterator throws `new Error('not implemented')`
- [X] T004 In `test/runtime.test.ts` extend `FakeSession` with `promptStreaming(input, { signal })` implemented as an async generator: it records `fake.streams++` and per-session `streamReturned` (its `finally` ran before the last chunk), appends `input` to history, and yields chunks from the next `fake.streamHooks` entry, or `['a', 'b', 'c']` by default. A hook is a list of steps: a string chunk, `{ hold: deferred }` (awaits the deferred and rejects with `signal.reason` if the signal aborts), or `{ error }` (throws). Add helpers `holdStream(chunksBefore)` and `failStream(chunksBefore, error)`. Do not modify existing tests or existing fake behavior

**Checkpoint**: 36/36 existing tests pass; the fake supports streaming

---

## Phase 3: User Story 1 - Consume output incrementally (Priority: P1) 🎯 MVP

**Goal**: `runtime.stream()` is lazy, single-use, yields chunks in order, and publishes final timing after cleanup

**Independent Test**: 3 chunks arrive in order, the loop ends, `live` is back to 1, and `timing` is complete

### Tests for User Story 1 ⚠️

- [X] T005 [US1] In `test/runtime.test.ts` add failing tests:
  - chunks `['a','b','c']` arrive in order via `for await`; after the loop `fake.live === 1`, the base's `prompts === 0`, `stream.timing` has numeric `queueWait`, `acquire`, `prompt`, `total` (FR-101/102/106/113)
  - `stream.timing === undefined` inside the loop body on every chunk (FR-113)
  - two sequential streams use distinct clones (FR-102)
  - **context isolation**: with `session: { initialPrompts: ['sys'] }`, stream A (`'remember X'`) then stream B (`'what word?'`): B's clone history is exactly `['sys', 'what word?']`, A's is `['sys', 'remember X']`, and the base history stays `['sys']` (001 SC-004 applied to streaming, US1 scenario 3)
  - a zero-chunk stream ends normally
  - `runtime.stream('x')` never iterated: `fake.clones === 0`, `fake.streams === 0`, `timing === undefined`, and with `limit: 1, queueCapacity: 0` a following `run()` still succeeds (FR-103)
  - streams created while ready but first pulled after `shutdown()` → `TaskError('closed')` and `timing` set; after a broken transition → `'broken'` (FR-103)
  - iterating the same stream twice: the second `next()` throws `TypeError` and `fake.clones` is unchanged (FR-112)

### Implementation for User Story 1

- [X] T006 [US1] In `src/index.ts` implement `stream(input, { signal } = {})`: return `s = { timing: undefined, async *[Symbol.asyncIterator]() { … } }`. In the body:
  - if `used`, throw `TypeError('stream already consumed')`; set `used = true`
  - `try { ({ t0, timing, sig } = await admit(signal)) } catch (e) { s.timing = (e as TaskError).timing; throw e }`
  - declare `let onAbort: (() => void) | undefined;` **before** `cleanup`, then the single-flight `cleanup = () => (cleaning ??= (async () => { if (onAbort) sig.removeEventListener('abort', onAbort); end(task, t0, timing); s.timing = timing; })())` (plan invariant 1). Declaring `onAbort` first ensures a cleanup that runs before the listener is registered (e.g. clone failure) cannot throw `ReferenceError` and replace the original `broken` / `failed` error
  - `try { task = await acquire(sig, timing); if (sig.aborted) throw cancelled; const t2 = now; try { for await (const chunk of task.promptStreaming(input, { signal: sig })) yield chunk; } catch (e) { throw sig.aborted ? cancelled(sig.reason) : failed(e) } timing.prompt = now - t2; } finally { await cleanup(); }`

**Checkpoint**: US1 tests pass; 001 tests still pass

---

## Phase 4: User Story 2 - Stop early without leaking (Priority: P1)

**Goal**: `break` / `return()` cancels the provider stream, destroys the session, and releases the slot before the loop exit completes, with no error

**Independent Test**: limit 1 with a queued task; `break` after the first chunk → the waiter starts and `live` is back to 1 when the `break` completes

### Tests for User Story 2 ⚠️

- [X] T007 [US2] In `test/runtime.test.ts` add tests:
  - `break` after the first chunk: no error thrown, the clone's `streamReturned === true`, `fake.live === 1` immediately after the loop, `stream.timing.prompt === undefined`, `stream.timing.total` is a number (FR-107, FR-113)
  - `limit: 1, queueCapacity: 1`: stream A held after its first chunk and a queued `run('B')`; `break` A → B resolves with no other action, and `fake.onDestroy` confirms A's clone was destroyed before B's clone (SC-103, FR-105)
  - `stream[Symbol.asyncIterator]().return()` before any `next()` → no clone (FR-103)
  - these may already pass after T006; that is expected, since async-generator `return()` provides the behavior (research S1, S4)

### Implementation for User Story 2

- [X] T008 [US2] Confirm T007 passes with the T006 implementation. If any case fails, fix it in `src/index.ts` without adding abstractions; no new code is expected (research S4)

**Checkpoint**: US1 + US2 pass

---

## Phase 5: User Story 3 - Cancellation, timeout, failure, and shutdown clean up (Priority: P1)

**Goal**: every external ending path cleans up without depending on the consumer pulling; shutdown awaits that cleanup

**Independent Test**: abort while the consumer is paused → `live` back to 1 without another pull; shutdown with a paused stream resolves with `live === 0`

### Tests for User Story 3 ⚠️

- [X] T009 [US3] In `test/runtime.test.ts` add failing tests:
  - caller abort while the generator awaits a held chunk → `TaskError('cancelled')`, `cause === signal.reason`, `live` back to 1 (FR-108)
  - `AbortSignal.timeout(20)` mid-stream → `'cancelled'`, `cause.name === 'TimeoutError'` (attach handlers first, then `sleep(40)`, per the 001 pattern)
  - `failStream(2, err)` → consumer receives 2 chunks, then `TaskError('failed', cause === err)`; `timing.prompt === undefined`
  - **paused consumer**: pull one chunk manually with `it.next()`, do not pull again, abort → after `await tick()`, without another pull: the `signal` that was passed to `promptStreaming` is `aborted` (provider work cancelled although the generator never resumed), the clone is destroyed, `fake.live === 1`, the slot is released (a following `run()` with `limit: 1` starts), and `stream.timing` is defined; the next `it.next()` rejects `'cancelled'` (FR-109, plan invariant 2)
  - **late clone**: `holdClone('late')`, abort, release → the late clone is destroyed, `fake.streams === 0`, outcome `'cancelled'`, `timing.acquire` is a number (FR-110)
  - **shutdown with paused stream**: a paused stream plus one queued stream; `await runtime.shutdown()` resolves with `fake.live === 0` and the paused stream's `promptStreaming` signal `aborted`; the paused stream's next pull rejects `'cancelled'` with `cause.name === 'AbortError'`; the queued stream's first pull rejects `'closed'` (FR-111, plan invariant 3)
  - **shutdown while the generator awaits a held chunk** → the same, and shutdown resolves only after the destroy (check `fake.onDestroy` ran before shutdown resolved)
  - **single-flight**: trigger cleanup concurrently from the listener (abort while paused), the generator `finally` (`it.return()` in the same tick), and `runtime.shutdown()` → exactly one destroy for the clone (`fake.destroys` delta 1), the slot released exactly once (afterwards with `limit: 1`, one held `run()` occupies the slot and a second `run()` waits, so `running` was not decremented twice), and no duplicate side effects (`stream.timing` assigned once to the same object). Known limit (research S1/plan invariant 1): the cleanup body is synchronous today, so this test cannot distinguish a shared Promise from a boolean guard; add an ordering test only if cleanup gains a real `await`. No production code is added for this
  - **completion vs cancellation race**: hold the last step of the stream; release it and abort the signal in the same tick → the consumer observes exactly one outcome (loop ends normally **or** `TaskError('cancelled')`, never both, and no second rejection), one cleanup, one destroy (`fake.destroys` delta 1), one slot release; do not assert which side wins (spec edge case)
  - **destroy throws**: with `fake.destroyThrows = true`, (a) a completed stream still ends normally, (b) a model-error stream still throws `TaskError('failed')`, (c) a cancelled stream still throws `'cancelled'`; in each case the slot is released (a following `run()` with `limit: 1` starts) and a subsequent `runtime.shutdown()` resolves (001 policy: destroy errors are swallowed; no new public error contract)
  - **broken**: a stream whose clone rejects `InvalidStateError` → `'broken'`, `runtime.state === 'broken'`; with `limit: 2`, a stream already streaming on its own clone completes all chunks after the transition (001 FR-011a)

### Implementation for User Story 3

- [X] T010 [US3] In `src/index.ts`, inside the stream generator after the session is obtained and the post-clone abort check passes, assign the existing variable `onAbort = () => void cleanup();` (declared in T006; do not declare a new one) and register `sig.addEventListener('abort', onAbort, { once: true })`. `cleanup()` already removes it when set. After each `yield`, add `if (sig.aborted) throw cancelled(sig.reason)` so a resumed paused consumer receives the cancellation. Confirm `shutdown()` needs no change: its `idle` gate opens only after `release()` inside `cleanup()` (plan invariant 3)

**Checkpoint**: US1–US3 pass

---

## Phase 6: User Story 4 - Same queue and admission rules as run() (Priority: P2)

**Goal**: streams and `run()` share one limit and one FIFO queue, ordered by first pull

**Independent Test**: limit 1, queue 1: stream, run, stream → run waits, second stream rejected, run starts only after the first stream's session is destroyed

### Tests for User Story 4 ⚠️

- [X] T011 [US4] In `test/runtime.test.ts` add the MVP queue/concurrency contract tests:
  - **shared limit**: `limit: 1, queueCapacity: 1`: stream A held after chunk 1 and `run('B')` queued → `fake.maxLiveClones === 1` while both are pending (FR-104)
  - **slot handoff**: release A → B resolves with no other action, and `fake.onDestroy` shows A's clone was destroyed before B's clone started (FR-105)
  - **reject on first pull**: with A running and B queued, stream C's first pull → `TaskError('rejected')` with `timing.queueWait === undefined`, no clone (FR-104)
  - **queued stream cancellation**: a stream waiting in the queue whose caller signal aborts → `'cancelled'`, no clone, `timing.queueWait` set, `getEventListeners(signal, 'abort').length` back to baseline (FR-104, 001 FR-010e)
  - **FIFO by first pull**: stream S created first but first pulled after `run('R')` was queued → R's clone precedes S's (FR-103)

### Implementation for User Story 4

- [X] T012 [US4] Confirm T011 passes through the shared `admit()`; no streaming-specific scheduler code (FR-104). Fix only in shared code if needed

**Checkpoint**: all stories pass → releaseable MVP (T001–T012)

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T013 In `test/runtime.test.ts` add the SC-102 test: 100 streams with `limit: 4, queueCapacity: 100` ending by completion, `break`, abort, timeout, and model error (deterministic pseudo-random mix), then `shutdown()` → every consumer loop settles, `fake.live === 0`, `fake.destroys === fake.clones + 1`
- [X] T014 In `test/runtime.test.ts` add the SC-104 stress validation (moved out of the MVP): 100 mixed `run`/`stream` submissions with `limit: 2, queueCapacity: 4` → `fake.maxLiveClones ≤ 2`; every task settles as success, `'rejected'`, or `'cancelled'`; `fake.live === 1` afterwards
- [X] T015 [P] In `README.md` add a "Streaming" section: `runtime.stream()` with `for await`, `break`, `AbortSignal.timeout`, `stream.timing` (undefined until the stream has fully ended), lazy start, single use, and the shared limit and queue
- [X] T016 Run `npm run build`, `npm test`, and `npx tsc --noEmit -p .`; confirm `dist/index.d.ts` exports exactly `createRuntime`, `TaskError`, `RuntimeOptions`, `Runtime`, `TaskResult`, `TaskTiming`, `TaskStream`, and that `package.json` has no `dependencies`

---

## Dependencies & Execution Order

- Phase 2 (T001 → T002 gate → T003 → T004) blocks everything
- US1 (T005–T006) → US2 (T007–T008) → US3 (T009–T010) → US4 (T011–T012) → Polish
- US2 and US4 need no new runtime code; they verify behavior provided by the async generator
  and the shared `admit()`
- The only `[P]` task is T015 (README), which can run anytime after T006

## Implementation Strategy

**Releaseable MVP = T001–T012 (Foundational + US1–US4).** The shared queue/concurrency contract
(US4) is part of the streaming feature definition (FR-104/105), so it is in the MVP. Only
stress validation (SC-102, SC-104) and docs are Polish.

1. T001–T002: refactor under the existing tests; stop if any 001 test changes behavior
2. US1: lazy stream with single-flight cleanup
3. US2: verify early-exit semantics
4. US3: paused-consumer listener; shutdown awaits cleanup
5. US4: shared limit, handoff, reject, queued cancel, first-pull FIFO → **MVP complete**
6. Polish: SC-102 and SC-104 stress tests, README, build/API check

## Notes

- Do not edit existing 001 tests (SC-105)
- Keep `src/index.ts` a single module
- No new runtime options, dependencies, or public members beyond `stream` and `TaskStream`

## Phase 8: Convergence

- [X] T017 Document in `specs/002-streaming-execution/contracts/public-api.md` and the README "Streaming" section that a stream's `timing.prompt` runs from the provider call to the loop observing the model's end, so with pull-based iteration it includes consumer processing time between chunks per FR-113 (partial)
- [X] T018 Record the manual real-Chrome check `smoke/` (`smoke/README.md`, run via `http://localhost:8080/smoke/streaming.html`) as a validation step in `specs/002-streaming-execution/quickstart.md` so it is traceable per plan: Project Structure (unrequested)

## Phase 9: Convergence

- [X] T019 Add to `specs/002-streaming-execution/contracts/public-api.md` (behavior table) and the README "Streaming" section that a stream's `timing.prompt` runs from the `promptStreaming()` call until the loop observes the model's end and, with pull-based iteration, includes consumer processing time between chunks; T017 was marked done but not applied, per FR-113 (missing)
- [X] T020 Add a "Manual real-Chrome smoke check" section to `specs/002-streaming-execution/quickstart.md` referencing `smoke/README.md` and `http://localhost:8080/smoke/streaming.html` (expected 5/5 PASS, no model download); T018 was marked done but not applied, per plan: Project Structure (missing)
