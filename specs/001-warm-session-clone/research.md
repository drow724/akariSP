# Research: Warm Base Session with Cloned Task Execution

Sources: Prompt API spec (https://webmachinelearning.github.io/prompt-api/), Chrome Prompt API
explainer, the feature spec and its clarifications.

## R1. Provider API surface actually used

- **Decision**: Call the global `LanguageModel` directly: `LanguageModel.create(options)`,
  `session.clone({ signal })`, `session.prompt(input, { signal })`, `session.destroy()`.
  Declare a minimal local TypeScript type for only these four members.
- **Rationale**: Principle VIII forbids a provider abstraction with one provider. A local
  4-member type avoids a dev dependency on a moving community typings package.
- **Alternatives considered**: `@types/dom-chromium-ai` (tracks Chrome churn; more surface than
  needed); a `Provider` interface (rejected: no second provider exists).

## R2. Classifying clone failures that break the runtime (spec deferred item)

- **Decision**: A clone rejection moves the runtime to `broken` when it is a `DOMException`
  named `InvalidStateError` and the task's own signal has not aborted. Every other clone
  rejection is **transient** (task fails with `code: 'failed'`, runtime stays `ready`).
- **Interpretation**: `InvalidStateError` is *not* taken as proof that the browser reclaimed
  or destroyed the base session. It only means the runtime can no longer trust the base to
  produce sessions for new tasks, so it stops admitting work. Tasks that already hold their
  own task session are independent of the base and keep running to their normal outcome.
- **Rationale**: The spec rejects `clone()` with `InvalidStateError` when the document is not
  fully active, and Chrome uses `InvalidStateError` for calls on sessions that are no longer
  usable. In both cases retrying the same base is not expected to succeed. `AbortError` is
  cancellation; `QuotaExceededError`, `NotAllowedError`, `UnknownError` may be transient or
  policy-driven and should not permanently break the runtime.
- **Alternatives considered**: Probe the base with a second clone on failure (adds latency
  and a second failure path); treat every clone failure as fatal (too aggressive for
  transient errors); cancel running tasks on `broken` (they do not depend on the base).
- **Known ceiling**: Classification relies on Chrome's current error naming; revisit if the
  spec defines destroyed-session behavior explicitly.

## R3. Cancellation mechanism

- **Decision**: When a task becomes a running task it gets
  `AbortSignal.any([callerSignal, runtimeSignal])`, where `runtimeSignal` belongs to a
  runtime-owned `AbortController` that `shutdown()` aborts with
  `new DOMException('Runtime closed', 'AbortError')`. The combined signal is passed to
  `clone()` and `prompt()`.
- **Race invariant (not a Chrome behavior claim)**: whatever the provider does on abort,
  AkariSP never leaks a task session. Two orderings are handled and tested:
  (A) `clone()` observes the abort and rejects with `AbortError` → task `cancelled`, nothing
  to destroy, `timing.acquire` undefined; (B) the abort fires but `clone()` still resolves
  later with a session → clone resolve → task session destroy → slot release → `cancelled`
  delivered, `timing.acquire` recorded, `prompt()` never called. The task is not settled
  at abort time: when its promise settles, everything it owned is already cleaned up
  (FR-009b). Implementation: after `clone()` settles, check `signal.aborted` before
  prompting.
- **Provider assumption**: the provider settles in-progress `clone()`/`prompt()` after abort
  (the `AbortSignal` contract). No watchdog in v0.1; a provider that stays pending forever
  after abort would hold the slot and block `shutdown()`, which is out of scope.
- **Timeouts**: `AbortSignal.timeout(ms)` as the caller signal needs no special code. Its
  reason is a `DOMException` named `TimeoutError`, which becomes `TaskError.cause`.
- **Shutdown reason**: only `cause.name === 'AbortError'` is contractual; the message string
  may change without a breaking release.
- **Rationale**: Principle IX: native primitives. The provider already honors `signal`, so
  AkariSP adds no polling or timers. Timeouts come free via `AbortSignal.timeout(ms)`.
- **Alternatives considered**: Custom cancellation tokens (reinvention); calling
  `session.destroy()` to interrupt a prompt (works but loses the abort reason).

## R4. Concurrency limit and queue

- **Decision**: An in-memory counter of occupied slots plus a FIFO array of waiting tasks,
  bounded by `queueCapacity`. Running-task lifecycle: slot acquire → clone start → clone
  complete → prompt → task session destroy → slot release. The slot is taken before
  `clone()` starts and released only after the task session (if any) is destroyed, so
  `limit` caps running tasks and therefore live task sessions. When a slot frees, the queue
  head becomes a running task. When both are full the submission is rejected; there is no
  other overflow behavior in v0.1, so no `overflow` option is exposed.
- **Waiter abort listeners**: a waiting task observes only the caller's signal (the runtime
  signal is not needed while waiting: shutdown and the broken transition drain the queue
  directly). It registers `addEventListener('abort', onAbort, { once: true })` and keeps the
  handler reference. `{ once: true }` only covers the path where the abort actually fires, so
  the listener is removed explicitly with `removeEventListener` on every other exit: the task
  starts running, is rejected, or is drained by shutdown/broken. All exits go through one
  `dequeue(waiter)` helper that removes the listener, so a signal reused across many tasks
  or for the app's lifetime holds no listeners from tasks that left the queue. Running tasks
  use `AbortSignal.any`, whose source-signal bookkeeping is owned by the platform.
- **Rationale**: Queue length is bounded (default 32), so an array with `splice`/`shift` is
  O(capacity) at worst: negligible. No scheduler library needed.
- **Alternatives considered**: A linked-list queue (unneeded at this size); a semaphore
  library (new dependency for ~20 lines); caller-runs overflow (removed in design review:
  it lets tasks run outside `limit`, weakening the hard-cap contract); an `overflow` option
  with a single value (config for a value that never changes; can be added non-breakingly
  when a second policy exists).

## R5. Error and outcome shape

- **Decision**: Success resolves `{ output, timing }`. Every non-success rejects with one
  error class, `TaskError`, carrying `code` (`'failed' | 'cancelled' | 'rejected' | 'closed'
  | 'broken'`), `cause` (original error or abort reason), and partial `timing`.
- **Rationale**: One class keeps the public surface small (Principle XII) while satisfying
  FR-008 (original error via standard `cause`), FR-006 (abort reason via `cause`), and
  FR-009a (partial timing). Codes let callers distinguish backpressure from failures.
- **Alternatives considered**: Rethrowing the original error unchanged (cannot carry timing
  without mutating foreign objects); one error class per outcome (5 exported classes).

## R6. Timing source and fields

- **Decision**: `performance.now()` at submit, slot/start, clone resolved, prompt resolved,
  end. Fields in milliseconds: `queueWait`, `acquire`, `prompt`, `total`. A field is set only
  once its phase completed (FR-009a): `acquire` when `clone()` resolved with a session (even if
  the task is then cancelled), undefined if `clone()` rejected. `total` is always set. A task
  that never waited reports `queueWait: 0`.
- **Rationale**: Monotonic, high-resolution, available in browsers and Node.
- **Alternatives considered**: `Date.now()` (low resolution, not monotonic);
  `performance.mark/measure` (global buffer growth; more overhead).

## R7. Language, build, and tests

- **Decision**: TypeScript 5.x source, compiled with `tsc` only (no bundler) to ESM +
  `.d.ts`. Zero runtime dependencies; `typescript` is the only dev dependency. Unit tests use
  Node's built-in `node:test` and run the `.ts` source directly via Node's native type
  stripping (Node ≥ 22.18 / ≥ 23.6) against a fake `globalThis.LanguageModel`.
- **Rationale**: Principle IV/IX: no test framework, no bundler, no runtime deps. Setting the
  global in tests avoids exposing an injection parameter in the public API (Principle XII).
- **Alternatives considered**: Vitest/Jest (extra dependency, no need); plain JS with JSDoc
  (weaker published types).

## R8. Benchmark design

- **Decision**: A static page `bench/index.html` + `bench/bench.js` that imports the built
  library and runs the same prompt list and session options two ways:
  - **cold**: per iteration `LanguageModel.create()` → `prompt()` → `destroy()`, timed by the
    benchmark itself with `performance.now()`.
  - **warm**: `createRuntime()` once (timed as **base create**, a one-time startup cost),
    then `runtime.run()` per iteration, reading the returned `timing`.
  Defaults: 3 warmup iterations per path (discarded), 30 measured iterations per path,
  cold and warm interleaved per iteration to reduce thermal/order bias, tasks sequential so
  `queueWait ≈ 0`.
- **Reported measures** (min / median / mean / p95 / max unless single-valued):

  | Measure | Source |
  |---|---|
  | cold create | `create()` duration |
  | cold prompt | `prompt()` duration |
  | cold total | create + prompt + destroy |
  | warm base create | single value, `createRuntime()` duration |
  | warm acquire | `timing.acquire` (clone) |
  | warm prompt | `timing.prompt` |
  | warm steady-state total | `timing.total` |
  | AkariSP overhead | `timing.total − timing.queueWait − timing.acquire − timing.prompt` |
  | warm amortized total @N | `(base create + Σ warm total) / N` for N = 1, 10, 30 |

  Plus environment (`navigator.userAgent`, `userAgentData` brands, `hardwareConcurrency`,
  `deviceMemory`) and the config, as JSON on the page.
- **Claim framing**: Reports and docs state that AkariSP **amortizes** session
  initialization across repeated tasks. The warm path still pays base creation once; the
  amortized-total rows make the break-even point visible.
- **Rationale**: SC-001, SC-002, SC-005 are measured in the real browser with the real model.
- **Alternatives considered**: Puppeteer automation (new dependency; the Prompt API needs a
  real Chrome profile with the model downloaded anyway); a Node benchmark with a fake model
  (measures overhead only; can be added if SC-002 needs isolation from model noise);
  reporting only steady-state warm totals (rejected: hides the startup cost).

## R9. Shutdown ordering

- **Decision**: The first `shutdown()` call synchronously stores its promise, then: sets
  state `closed`, rejects waiters with `code: 'closed'`, aborts the runtime controller
  (running tasks settle as `cancelled`), awaits all running task promises with
  `Promise.allSettled` (each task destroys its own session in `finally`), then destroys the
  base session. Every later or concurrent call returns that same stored promise. The promise
  never rejects: destroy errors are swallowed, as for task sessions. Works from `ready` and
  `broken` alike.
- **Rationale**: Caching the promise before any `await` makes concurrent calls converge on
  one cleanup with no extra state (FR-011c), and `await runtime.shutdown()` resolving implies
  every queued/active task has settled and every session is destroyed (FR-011).
