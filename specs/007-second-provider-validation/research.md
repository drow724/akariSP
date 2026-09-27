# Research: Second Provider Validation (WebLLM)

Evidence: E1–E9, E6b, E7b (spec "Research Evidence"; `experiments/webllm/`). Sources read:
WebLLM `engine.ts` / `support.ts` at tag `v0.2.85` (what npm ships) and at `main` `bd46399`.
Current core: `src/core/runtime.ts` after 005/006.

## D1. Where the core is Chrome-shaped today (exact touch points)

| Core site | Chrome assumption | Evidence |
|---|---|---|
| `acquire`: `await base.clone({ signal })` | a task is a clone of the base | E2 (TypeError), E1 (no per-task object needed) |
| `acquire`: `e instanceof DOMException && e.name === 'InvalidStateError'` | Chrome's broken vocabulary | E8 |
| `end`: `task?.destroy()` not awaited | task cleanup is synchronous | E6/E6b (drain is async), E7 |
| creation rollback and `shutdown`: `b.destroy()` not awaited | base cleanup is synchronous | E7 (68 ms), E7b |
| `Session` type = base and task | base and task are the same kind | E2, E9 |

Everything else (admission, queue, FIFO, slots, templates map, lazy streams, single-flight
cleanup, abort composition, broken propagation, snapshot, idempotent shutdown) is
provider-neutral already and is not touched.

## D2. Minimal seam: start, broken, destroy(base)?, close()?; the base type is opaque

- **Decision** (internal, `src/core/runtime.ts`):

  ```ts
  export interface Session {                       // the per-task execution unit
    prompt(input: Prompt, options: { signal: AbortSignal }): Promise<string>;
    promptStreaming(input: Prompt, options: { signal: AbortSignal }): AsyncIterable<string>;
    destroy(): void | Promise<void>;               // task cleanup; awaited before the slot is released
  }
  export interface SessionProvider<B> {
    create(config?: object): Promise<B>;           // long-lived resource per template (as today)
    start(base: B, options: { signal: AbortSignal }): Promise<Session>;  // replaces base.clone()
    broken(error: unknown): boolean;               // replaces the core's DOMException rule
    destroy?(base: B): void | Promise<void>;       // per-template resource cleanup; awaited
    close?(): void | Promise<void>;                // provider-wide shared resource cleanup; awaited, last
  }
  export async function createCoreRuntime<B>(provider: SessionProvider<B>, options?: RuntimeOptions): Promise<Runtime>;
  ```

- **Why this and not less**: each member removes exactly one D1 assumption. `B` is opaque to the
  core, so base and task need not be the same kind (FR-604). `destroy` returning
  `void | Promise<void>` lets Chrome's native synchronous `destroy()` satisfy the type unchanged.
  `destroy(base)` and `close()` are separate because E9 + E7 show two different lifetimes: a
  per-template resource (Chrome's warm session; nothing on WebLLM) and a provider-wide shared
  resource (WebLLM's engine; nothing on Chrome). Each provider implements only the one it has,
  so both are optional; the core calls each only if present. Using an idempotent `unload()` per
  template base would pretend the engine belongs to a template (rejected, D6).
- **Why not more**: no capabilities, no execution strategy, no registry, no lifecycle adapter,
  no error taxonomy (one predicate), no new stream type (FR-612: `AsyncIterable<string>` fits both).
- **Alternatives rejected**:
  - `clone?()` optional on `Session`: keeps the Chrome shape in the core and still forces
    WebLLM to be a `Session` base.
  - Separate `Base` and `Task` interfaces with methods on the base: the base would need a
    method set, which pushes WebLLM toward a wrapper object.
  - `provider.run(base, input)` / `provider.stream(...)` without a task object: task cleanup
    would have no handle to await, so a paused stream could not be cleaned up (002 FR-009b).

## D3. Chrome keeps native clone, with no wrapper

```ts
// src/browser/runtime.ts
interface NativeSession extends Session { clone(o?: { signal?: AbortSignal }): Promise<NativeSession> }
declare const LanguageModel: { create(o?: object): Promise<NativeSession> };
const promptApi: SessionProvider<NativeSession> = {
  create: (config) => LanguageModel.create(config),
  start: (base, options) => base.clone(options),
  broken: (e) => e instanceof DOMException && e.name === 'InvalidStateError',
  destroy: (base) => base.destroy(),
};
```

- The object `clone()` returns is the native session, and it is the `Session`. There is no
  wrapper (same as 005).
- The broken predicate is the 005 condition moved verbatim. `!sig.aborted` stays in the core,
  because abort precedence is core policy.
- Chrome's `destroy()` is still synchronous; the core now awaits it, which costs one microtask.

## D4. Broken is decided at task start only (unchanged stage)

- **Decision**:
  - The core calls `provider.broken(e)` only on a `start()` rejection, as it does today for
    `clone()`. Execution failures stay `failed`.
  - WebLLM's `start()` first calls `engine.getMessage()`, a native read-only call in v0.2.85
    (line 1310). When the engine is unloaded it throws `ModelNotLoadedError` from
    `getLLMStates`, so a task on an unloaded engine is classified broken before any request.
- **Rationale**: FR-607 keeps Chrome's condition "exactly". Classifying execution failures too
  would turn a Chrome `prompt()` `InvalidStateError` from `failed` into `broken`, which is a
  behavior change. E7 and E8 need broken detection only for "engine no longer loaded", and the
  start probe covers that.
- **WebLLM predicate**: `e?.name === 'ModelNotLoadedError' || e?.name === 'DeviceLostError'`,
  applied only to `start()` rejections. Only `ModelNotLoadedError` was observed (E7, E8).
- **What 007 does not promise**: a resource-fatal failure **during generation** (for example
  device loss mid-stream) is not promoted to runtime-wide broken at that moment. That task ends
  `failed`, as it does on Chrome today. The runtime becomes broken only when a later task's
  `start()` health check (`getMessage()`) rejects with a broken-classified error. Device loss is
  unobserved and may not surface at start at all, in which case later tasks keep failing
  individually until shutdown. Promoting execution-stage failures would be a new error path for
  both providers; it is deferred until evidence requires it.

## D5. WebLLM task lifecycle (single in-flight, interrupt + drain)

`src/webllm/runtime.ts`, v0.2.85 behavior per E3–E6b:

```text
AkariSP queue → slot (limit 1) → start(base, {signal}):
  await engine.getMessage()                  // broken probe (D4)
  → Session { prompt, promptStreaming, destroy }
promptStreaming(input, {signal}):
  it = await engine.chat.completions.create({ messages: [...base.initialPrompts, user input], stream: true })
       // 0.2.85 takes the engine lock here; limit 1 means it is always free
  abort listener → engine.interruptGenerate()
  pull with it.next() manually (never for-await over `it`: exiting a for-await calls it.return(),
       which leaks the 0.2.85 lock, E6)
  yield delta text; when done → finished = true
  if signal.aborted when the stream ends → throw signal.reason   (interrupt ends without error, E8)
prompt(input, {signal}):
  accumulate promptStreaming(...)            // always streaming: immune to the stale flag (E5)
destroy():
  if a request was created and has not finished:
    await it.next() once if it was never pulled   // 0.2.85: the lock is taken at create(), and the
                                                  // interrupt flag is reset on the FIRST next()
                                                  // (line 536), so an interrupt before it would be lost
    await engine.interruptGenerate()
    await it.next() until done                    // drain releases the lock (E6b)
  (called once per task by the core's end())
→ core releases the slot only after destroy() resolved
```

- Early break, abort, timeout, and shutdown all reach `destroy()` through the core's existing
  cleanup: `end()`, or single-flight stream cleanup, including the paused-consumer abort
  listener. So one drain path covers all four.
- Ceiling: a task cleaned up right after its request was created generates at most one extra
  chunk before the interrupt takes effect, so its cleanup is delayed by up to one
  time-to-first-token. This applies to caller abort, timeout, and shutdown alike.
- No provider queue. `limit > 1` is rejected at creation (FR-613), so AkariSP's own queue holds
  every waiting task, and cancelling one of them never touches the engine (E4).
- `run()` and `stream()` public semantics are unchanged (FR-611). A partial output after
  interrupt is never returned as success, because the adapter throws `signal.reason` and the
  core maps it to `cancelled`.

## D6. Templates and long-lived cleanup on WebLLM

- **Decision**: WebLLM `create(config)` returns the config object itself as the base. No
  loading happens there; the engine is already created by the application. `start` builds each
  request from `base.initialPrompts` plus the task input. There is no `destroy(base)`, because a
  config holds no resource. `close()` awaits `engine.unload()` once, after every task has ended.
- The core still keeps one base per template: its `bases` Map, rollback, and `pick` are
  unchanged. For WebLLM a base is only a configuration, so N templates still mean one engine
  (FR-614, E9).
- **Engine ownership** (007 internal integration; 008 may redesign it):
  - The application creates the engine before creating the runtime.
  - Once `createWebLLMRuntime` resolves, the runtime uses the engine exclusively. The caller must
    not start its own generations on it during the runtime's lifetime; doing so would break the
    single in-flight guarantee and the E4/E5 cancellation correctness.
  - `shutdown()` unloads the engine.
  - If runtime creation fails (for example `limit > 1`, or any validation or create error),
    ownership never transfers and the injected engine is not unloaded. `close()` is therefore
    called only by `shutdown`, never by creation rollback.

## D7. Core async cleanup placement (smallest ordering change)

- `end(task, …)` becomes `async`: `try { await task?.destroy(); } catch {}` → `release()` →
  `total`. `run`'s `finally` awaits it. The stream cleanup already awaits a single-flight
  promise, and it now awaits `end`. The slot is still released only after task cleanup, now
  including async cleanup (FR-605).
- **Rollback**: `for (const b of bases.values()) try { await provider.destroy?.(b); } catch {}`,
  sequential, then rethrow the original creation error. There is no `close()` here, since
  ownership was never taken.
- **Shutdown**: closed → drain queue → abort → await idle (every task cleaned up, since release
  follows `destroy`) → `await provider.destroy?.(b)` for each base → `await provider.close?.()`
  → resolve. Each step is in its own try/catch (FR-606, E7b).
- **Regression risk**: one extra microtask per task end on Chrome. The 90-plus existing
  timing-sensitive tests are the gate.
- **Found at the T005 gate**: always awaiting `end()` failed the 002 test "concurrent cleanup
  triggers". That test requires a paused consumer's abort to publish `stream.timing` in the same
  turn. So `end()` stays synchronous when `destroy()` returns nothing and awaits only a returned
  promise. Chrome's ordering is exactly the same as before (0 extra microtasks), and async
  providers are still awaited. No assertion was changed.

## D8. Validation layers

- **Core, automated**: the existing suite with its harness provider adapted to the D2 shape
  (Chrome-like fake: `start = base.clone`). No assertion changes. New tests:
  - a clone-less, request-style fake provider running the same lifecycle;
  - async task/base cleanup ordering and shutdown awaiting it: task destroy → base destroy →
    close → resolve;
  - async rollback: bases A and B created, C's create rejects with `err`, `destroy(B)` rejects
    asynchronously and `destroy(A)` resolves asynchronously. Both are attempted, `close` is not
    called, and `createCoreRuntime` rejects with exactly `err`.
- **WebLLM adapter, automated** (`test/webllm.test.ts`): a fake engine that reproduces v0.2.85's
  lock taken at `create()`, released only at the natural end, the engine-wide interrupt flag, and
  `unload`. The tests would fail if the adapter used `return()` or a non-streaming path. They
  cover:
  - `limit > 1` → TypeError;
  - template prefix;
  - no `clone` property anywhere;
  - broken on `ModelNotLoadedError` at start;
  - drain before slot release;
  - `unload` exactly once, after tasks, via `close`;
  - no `unload` when creation fails (`limit > 1`);
  - **pre-pull cancellation**: abort, timeout, or shutdown right after the request is created
    and before any `next()` (never pulled), and while the first token is pending. The fake's
    first token is a test-released deferred gate, not a wall-clock sleep. Cleanup completes, the
    lock is released, the next task executes, and the native `return()` is never called.
  - **paused consumer**: after 1 chunk the consumer stops pulling and aborts. The drain runs
    while the adapter generator is suspended, and the slot is released.
- **Boundary**: core code (comments stripped) contains no `clone`, `InvalidStateError`, or
  WebLLM/browser import. `src/webllm/` imports only the core.
- **Real browsers**:
  - `smoke/streaming.html` on Chrome: the existing 7 lifecycle checks.
  - New `smoke/webllm.html`: the 9 FR-615 checks through `dist/webllm/runtime.js` with the
    research model.
- **Evidence** (FR-618): `experiments/webllm/EVIDENCE.md` has one row per experiment with the 9
  metadata fields. The existing `results/*.json` stay unchanged.
