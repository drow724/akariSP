---

description: "Task list for 001-warm-session-clone"
---

# Tasks: Warm Base Session with Cloned Task Execution

**Input**: Design documents from `/specs/001-warm-session-clone/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/public-api.md,
quickstart.md

**Tests**: Included. The spec defines independent tests per story and measurable criteria
(SC-003, SC-004, SC-006), and quickstart.md maps each to a unit test. Tests are written
first and must fail before the matching implementation task.

**Organization**: Tasks are grouped by user story. The plan deliberately uses one source file
(`src/index.ts`) and one test file (`test/runtime.test.ts`), so most tasks touch the same
files and are sequential; `[P]` is used only where files differ.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from spec.md (US1–US5)

## Path Conventions

Single package at repository root: `src/`, `test/`, `bench/` (see plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package scaffolding with zero runtime dependencies

- [X] T001 Create `package.json` at repo root: `"name": "akarisp"`, `"version": "0.1.0"`, `"type": "module"`, `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, `"files": ["dist"]`, `"engines": { "node": ">=22.18" }`, scripts `"build": "tsc"` and `"test": "node --test test/"`, `devDependencies` `typescript` `^5` only, no `dependencies`; run `npm install`
- [X] T002 [P] Create `tsconfig.json`: `target` `ES2022`, `module` `ES2022`, `moduleResolution` `Bundler`, `lib` `["ES2022", "DOM"]`, `strict` true, `declaration` true, `rootDir` `src`, `outDir` `dist`, `include` `["src"]`
- [X] T003 [P] Create `.gitignore` with `node_modules/` and `dist/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Public types, error class, runtime construction, and the fake provider every test uses

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 In `src/index.ts` declare a minimal local type for the global `LanguageModel` with only `create(options?)`, and session `clone({ signal? })`, `prompt(input, { signal? })`, `destroy()` (research R1; no provider interface, Principle VIII). Export types exactly as in `contracts/public-api.md`: `RuntimeOptions` (`session?`, `limit?`, `queueCapacity?` — no `overflow` option), `Runtime` (`readonly state: 'ready' | 'broken' | 'closed'`, `run`, `shutdown`), `TaskResult` (`output: string`, `timing`), `TaskTiming` (`queueWait?`, `acquire?`, `prompt?` optional; `total` required; all ms)
- [X] T005 In `src/index.ts` export `class TaskError extends Error` with `readonly code: 'failed' | 'cancelled' | 'rejected' | 'closed' | 'broken'`, `cause` (via standard `Error` options), and `readonly timing: TaskTiming` (research R5)
- [X] T006 In `src/index.ts` export `createRuntime(options?)`: validate before creating any session and throw `TypeError` (async rejection) if `limit` is not an integer ≥ 1 or `queueCapacity` is not a finite integer ≥ 0; apply defaults `limit = 1`, `queueCapacity = 32`; call `LanguageModel.create(options.session)` once and let its rejection propagate unchanged; return a runtime object with `state = 'ready'` and stub `run`/`shutdown` (FR-001, FR-010a, FR-010g)
- [X] T007 Create `test/runtime.test.ts` (Node `node:test` + `node:assert/strict`, imports `../src/index.ts`) with a fake installed on `globalThis.LanguageModel` before each test: each session records its prompt history (copied on `clone`), fake tracks `live` session count, `maxLiveClones`, `create`/`clone`/`destroy` call counts, and per-session `prompt` call counts; `prompt` resolves via a per-call controllable deferred (or immediately with a canned reply) and rejects with `signal.reason` when its signal aborts; `clone` supports two per-call modes for race tests — (A) **honor signal**: reject with `signal.reason` (an `AbortError`) when the signal aborts, and (B) **late resolve**: ignore the signal and resolve with a new session only when the test releases a held deferred; hooks to make the next `clone` or `prompt` reject with a given error (e.g. `new DOMException('x', 'InvalidStateError')`, `new DOMException('x', 'QuotaExceededError')`) and to make `destroy` throw. These modes express AkariSP race scenarios, not claims about Chrome's behavior. Listener counts are read with `getEventListeners(signal, 'abort')` from `node:events`
- [X] T008 Add foundational tests in `test/runtime.test.ts`: invalid `limit` (0, 1.5) and `queueCapacity` (-1, 1.5, `Infinity`) reject `TypeError` with `create` never called; `create` rejection propagates unchanged; new runtime has `state === 'ready'`; `session` options are passed to `create` unchanged

**Checkpoint**: `npm test` runs; foundational tests pass

---

## Phase 3: User Story 1 - Run isolated tasks from a warm base session (Priority: P1) 🎯 MVP

**Goal**: `run()` clones the base, prompts the clone, destroys it, returns output with timing

**Independent Test**: Task A says "remember X", task B asks for it; B has no knowledge of X, both succeed, base never prompted

### Tests for User Story 1 ⚠️

- [X] T009 [US1] In `test/runtime.test.ts` add failing tests: result `output` equals the fake's reply; base session never receives `prompt` (FR-002); each `run` performs exactly one `clone` (FR-003); the clone is destroyed exactly once after success and `live` returns to 1 (base only) (FR-004, FR-005); task B's clone history contains only base initial prompts, not task A's prompt (SC-004); three concurrent runs with `limit: 3` each use a distinct clone

### Implementation for User Story 1

- [X] T010 [US1] Implement `run(input, options)` in `src/index.ts`: mark `performance.now()` at submit, `clone()` the base, `prompt(input)` on the clone, destroy the clone in a single `finally` (swallow destroy errors), resolve `{ output, timing }` with all four `TaskTiming` fields (`queueWait` = 0 here) (FR-009, research R6)

**Checkpoint**: US1 tests pass; MVP usable (no cancellation, no limit enforcement yet)

---

## Phase 4: User Story 2 - Cancel tasks and always clean up (Priority: P1)

**Goal**: Cancellation via `AbortSignal`, failure wrapping, deterministic cleanup, broken transition

**Independent Test**: Cancel mid-prompt, cancel before start, fail during prompt; each surfaces the right outcome and `live` returns to 1

### Tests for User Story 2 ⚠️

- [X] T011 [US2] In `test/runtime.test.ts` add failing tests: already-aborted signal → `TaskError` `code: 'cancelled'`, `clone` never called (FR-007); abort during prompt → `'cancelled'`, `cause === signal.reason`, clone destroyed (FR-006); **clone race A**: clone in honor-signal mode, abort while pending → `'cancelled'`, no session created, `live` back to 1; **clone race B**: clone in late-resolve mode, abort while pending, assert the task promise is still pending, then release the clone → task outcome `'cancelled'`, the late session was destroyed before the promise settled (`live` back to 1 at settle time), its `prompt` count is 0, `timing.acquire` is a number; race A additionally asserts `timing.acquire === undefined`; **timeout during acquisition**: `AbortSignal.timeout(20)` with clone in late-resolve mode held past the timeout → `'cancelled'`, `cause.name === 'TimeoutError'`, late clone destroyed, never prompted, `timing.acquire` is a number (session was obtained), `timing.prompt === undefined`, `timing.total` set; same timeout with clone in honor-signal mode (rejects `AbortError`) → `timing.acquire === undefined`; **timeout during prompt**: `AbortSignal.timeout(20)` with prompt held → `'cancelled'`, `cause.name === 'TimeoutError'`, clone destroyed, `timing.acquire` set, `timing.prompt === undefined`, `live` back to 1 (constitution quality gate: error/timeout/abort paths); prompt rejection → `'failed'` with `cause` the original error, clone destroyed (FR-008); `destroy` throwing does not replace the outcome; abort after prompt resolved keeps the success; after each outcome a new `run` succeeds (US2 scenario 4); `clone` rejecting `QuotaExceededError` → `'failed'`, `state` stays `'ready'` (research R2 transient); `clone` rejecting `InvalidStateError` → `'broken'` with original `cause`, `state === 'broken'`, next `run` rejects `'broken'` without calling `clone`, `create` not called again (FR-011a, FR-011b)

### Implementation for User Story 2

- [X] T012 [US2] In `src/index.ts` add a runtime-owned `AbortController`; when a task becomes a running task build `AbortSignal.any([...])` from the caller signal (if any) and the runtime signal; reject immediately with `'cancelled'` if already aborted; pass the signal to `clone` and `prompt`; after `clone` settles, if the signal is aborted, record `acquire` if a session was returned, destroy it without prompting, and only then reject `'cancelled'` with `cause = signal.reason` (FR-009b; T021 adds slot release before this rejection) — this single check covers both race A and race B and timeouts (research R3)
- [X] T013 [US2] In `src/index.ts` wrap every non-success outcome in `TaskError` with the partial `timing` collected so far (unreached fields left `undefined`, `total` always set) (FR-009a): abort → `'cancelled'` with `cause = signal.reason`; clone rejects `DOMException` `name === 'InvalidStateError'` while not aborted → set `state = 'broken'`, reject `'broken'` (do not assume the base was reclaimed; do not recreate it; research R2); other failures → `'failed'`; `run` in state `'broken'` rejects `'broken'` immediately

**Checkpoint**: US1 + US2 tests pass

---

## Phase 5: User Story 3 - Measure the warm path against the cold path (Priority: P2)

**Goal**: Timing semantics verified; browser benchmark reports cold vs warm incl. one-time base create

**Independent Test**: Run the benchmark with fixed workload; report shows every FR-013 measure with median/p95 and environment

### Tests for User Story 3 ⚠️

- [X] T014 [US3] In `test/runtime.test.ts` add timing tests: success has `queueWait`, `acquire`, `prompt`, `total` all numbers ≥ 0 and `total ≥ queueWait + acquire + prompt`; pre-aborted task has `total` only; prompt failure has `queueWait`, `acquire`, `total` and `prompt === undefined`; clone failure has no `acquire`/`prompt`

### Implementation for User Story 3

- [X] T015 [P] [US3] Create `bench/index.html`: a Run button, inputs for iterations (default 30) and warmup (default 3), a `<pre>` for JSON output, and `<script type="module" src="./bench.js">`
- [X] T016 [US3] Create `bench/bench.js` importing `../dist/index.js`: fixed prompt list and session options shared by both paths; `createRuntime()` once timed as `baseCreate` (single value); warmup iterations discarded; then per iteration interleave cold (`LanguageModel.create` → `prompt` → `destroy`, timed with `performance.now()` into `create`, `prompt`, `total`) and warm (`runtime.run`, reading `timing`); sequential only (research R8)
- [X] T017 [US3] In `bench/bench.js` compute min / median / mean / p95 / max for cold `create`, `prompt`, `total` and warm `acquire`, `prompt`, `total`, `overhead` (`total − queueWait − acquire − prompt`); amortized warm total `(baseCreate + Σ warm total) / N` for N = 1, 10, 30; add `env` (`navigator.userAgent`, `navigator.userAgentData?.brands`, `hardwareConcurrency`, `deviceMemory`) and `config`; print JSON; call `runtime.shutdown()` at the end
- [X] T018 [P] [US3] Create `bench/results/.gitkeep` and `bench/README.md` with the run procedure from quickstart.md §2, pass criteria (SC-001: `warm.acquire.median × 10 ≤ cold.create.median`; SC-002: `warm.overhead.median < 1`), result file naming (`YYYY-MM-DD-<device>.json`), and the wording rule: AkariSP **amortizes** session initialization across repeated tasks, it does not eliminate it

**Checkpoint**: Timing tests pass; `npm run build` then benchmark page renders a report in Chrome

---

## Phase 6: User Story 4 - Bound concurrency with a bounded queue (Priority: P2)

**Goal**: `limit` as an absolute cap on running tasks, FIFO queue of `queueCapacity`, reject when full

**Independent Test**: `limit: 2`, `queueCapacity: 1`, 5 long tasks → 2 run, 1 waits, 2 rejected; running never > 2

### Tests for User Story 4 ⚠️

- [X] T019 [US4] In `test/runtime.test.ts` add failing tests: `limit: 2`, `queueCapacity: 1`, 5 held tasks → 2 running tasks, 1 waiting, 2 `'rejected'` with no clone and timing `total` a number while `queueWait`, `acquire`, `prompt` are `undefined` (FR-009a), `maxLiveClones === 2` (FR-010a, FR-010c, FR-010f); a running task whose prompt resolved but whose `destroy` is still in progress does not let a waiter start early (slot released only after destroy, FR-010f); waiting tasks become running tasks in FIFO order (FR-010b); abort of a waiting task → `'cancelled'`, no clone, `timing.queueWait` and `total` set, `acquire` undefined (FR-010e); **listener cleanup**: one caller signal shared by a held running task and 1 waiter per scenario — waiter starts, waiter aborted, waiter rejected on broken, waiter drained by shutdown — after each scenario settles `getEventListeners(signal, 'abort').length` is back to its baseline; and 50 sequential `run` calls reusing one signal leave the count at baseline (FR-010e); `queueCapacity: 0` rejects once limit reached; a failed or cancelled running task frees its slot and the next waiter starts; defaults: with 1 held task, 32 more wait and the 34th is `'rejected'` (FR-010g); a waited task's success `timing.queueWait > 0`; burst of 100 with `limit: 2`, `queueCapacity: 4` → every promise settles as success/`'rejected'`/`'cancelled'`, `maxLiveClones ≤ 2` (SC-006)
- [X] T020 [US4] In `test/runtime.test.ts` add the broken-under-concurrency test: `limit: 2`, `queueCapacity: 1`; task A clones and is held in prompt; task B's `clone` rejects `InvalidStateError` → B `'broken'`, `state === 'broken'`, queued task C rejected `'broken'` without clone, new `run` rejected `'broken'`; then release A → A resolves successfully and its clone is destroyed (FR-011a, spec edge case)

### Implementation for User Story 4

- [X] T021 [US4] In `src/index.ts` add admission per data-model.md: `running < limit` → become a running task; else `queue.length < queueCapacity` → enqueue; else reject `'rejected'`. Running-task lifecycle: slot acquire → clone start → clone complete → prompt → task session destroy → slot release; take the slot before `clone` starts and release it only after the task session (if any) is destroyed; on release, if `state === 'ready'`, start the queue head. A waiter registers `signal.addEventListener('abort', onAbort, { once: true })` on the caller signal only and keeps `onAbort`; every exit from the queue (start, abort, `'rejected'`, shutdown drain, broken drain) goes through one `dequeue(waiter)` helper that calls `removeEventListener('abort', onAbort)` — `{ once: true }` alone only covers the abort path. Waiters record `queueWait` (enqueue → leaving the queue) inside `dequeue`, so it is set on every queue exit including the broken drain; tasks admitted directly record `queueWait = 0`; tasks rejected before entering the queue leave it undefined (data-model Task Timing). Every task's promise settles only after its slot release (FR-009b). On entering `'broken'`, drain all waiters via `dequeue` rejecting `'broken'` and leave running tasks untouched (research R4)

**Checkpoint**: US1–US4 tests pass

---

## Phase 7: User Story 5 - Shut down the runtime (Priority: P3)

**Goal**: Idempotent shutdown that rejects waiters, cancels running tasks, destroys every session, then resolves

**Independent Test**: One running + one queued task, shutdown → running `'cancelled'`, queued `'closed'`, `live === 0` when shutdown resolves, later `run` → `'closed'`

### Tests for User Story 5 ⚠️

- [X] T022 [US5] In `test/runtime.test.ts` add failing tests: running task → `'cancelled'` with `cause.name === 'AbortError'` (do not assert the message text), queued → `'closed'`, `live === 0` (base and clones destroyed) when `await runtime.shutdown()` resolves, `state === 'closed'`, later `run` → `'closed'` without clone (FR-011); shutdown while a clone is pending in late-resolve mode → after release the late clone is destroyed, never prompted, and shutdown resolves only afterwards; second sequential call and two concurrent calls return the same promise, never reject, destroy counts unchanged (FR-011c); shutdown from `'broken'` resolves and destroys the base; broken variant: after T020's setup with A still held, shutdown → A `'cancelled'` with `cause.name === 'AbortError'`, `live === 0`; prompt resolving in the same tick as shutdown yields exactly one outcome
- [X] T023 [US5] In `test/runtime.test.ts` add SC-003 test: 100 tasks with `limit: 4`, `queueCapacity: 100` mixing successes, prompt failures, and aborts at random phases, then shutdown → every promise settled, `live === 0`, `destroy` count equals `clone` count + 1

### Implementation for User Story 5

- [X] T024 [US5] In `src/index.ts` implement `shutdown()` per research R9: if a stored `closing` promise exists return it; otherwise store it synchronously before any `await`, then set `state = 'closed'`, drain all waiters via `dequeue` rejecting `'closed'` (each with `queueWait` recorded by `dequeue`), abort the runtime controller with `new DOMException('Runtime closed', 'AbortError')` (only the `AbortError` name is contractual) so running tasks settle `'cancelled'`, `await Promise.allSettled` of running-task promises (each destroys its own session and releases its slot), destroy the base (swallow errors); the promise never rejects. `run` in `'closed'` rejects `'closed'` immediately

**Checkpoint**: All stories pass `npm test`

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T025 [P] Create `README.md`: purpose, install, `createRuntime`/`run`/`shutdown`/`state`/`TaskError` example with `AbortSignal.timeout`, defaults (limit 1, queue 32, reject), states, and the amortization framing with a link to `bench/README.md`
- [X] T026 Run `npm run build` and `npm test`; confirm `dist/index.d.ts` exports only `createRuntime`, `TaskError`, and the types in `contracts/public-api.md` (Principle XII) and `package.json` has no `dependencies` (Principle VII)
- [X] T027 Manual: run the benchmark in Chrome per quickstart.md §2, save the JSON to `bench/results/YYYY-MM-DD-<device>.json`, and record SC-001 / SC-002 pass or fail in `bench/README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories → **Polish (Phase 8)**
- Stories share `src/index.ts` and `test/runtime.test.ts`, so they run sequentially in
  priority order: US1 → US2 → US3 → US4 → US5

### User Story Dependencies

- **US1**: after Foundational
- **US2**: after US1 (adds cancellation and error wrapping to `run`)
- **US3**: timing tests after US2 (partial timing on errors); bench files (T015–T018) only
  need US1 and can be written any time after it
- **US4**: after US2 (admission reuses cancellation and `TaskError`)
- **US5**: after US4 (shutdown drains the queue and running set)

### Within Each User Story

- Tests first, confirm they fail, then implement

### Parallel Opportunities

- T002, T003 alongside T001
- T015 and T018 (bench page, bench README) alongside any `src/` or `test/` task after US1
- T025 (README) alongside T026

---

## Parallel Example: User Story 3

```bash
Task: "Create bench/index.html with Run button, iteration inputs, JSON output"
Task: "Create bench/results/.gitkeep and bench/README.md with procedure and pass criteria"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2
2. Phase 3 (US1) → validate context isolation and cleanup on success
3. Stop and demo if needed

### Incremental Delivery

1. US1 → isolated tasks
2. US2 → cancellation, failure, broken state (minimum for real use)
3. US3 → benchmark evidence for the performance claim
4. US4 → backpressure
5. US5 → deterministic shutdown

---

## Notes

- `[P]` = different files, no incomplete dependencies
- Keep `src/index.ts` a single module (plan.md Structure Decision)
- Commit after each phase checkpoint
