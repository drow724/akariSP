# Implementation Plan: Second Provider Validation (WebLLM)

**Branch**: `007-second-provider-validation` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-second-provider-validation/spec.md`

## Summary

Replace the core's Chrome-shaped assumptions with provider operations (start, broken, per-template destroy, provider-wide close) and nothing
else:

| Before (Chrome-shaped core) | After (provider operation) |
|---|---|
| `base.clone()` | `start(base)` |
| the core's `DOMException` / `InvalidStateError` rule | `broken(e)` |
| synchronous `base.destroy()` | awaited `destroy(base)` (per-template) and awaited `close()` (provider-wide) |
| synchronous `task.destroy()` | awaited `task.destroy()` |

The base type becomes opaque to the core, and the policy code stays as it is.

- **Chrome:** keeps its native lifecycle with no wrapper. `start = base.clone`, the native
  session is the task, and the broken predicate is moved from the core unchanged.
- **WebLLM:** a new internal module, `src/webllm/runtime.ts`. It receives an application-created
  engine and uses the template config as the base. Each task is one streaming request with the
  interrupt + drain cleanup proven by E6b. `limit > 1` is rejected. The engine is the
  provider-wide resource: shutdown awaits `unload()` once through `close()`, and a failed
  creation never unloads it.

Public API: unchanged. Runtime dependencies: 0. No fake clone, registry, capability,
strategy, or provider queue.

## Technical Context

**Language/Version**: TypeScript 5.9 → ES2022 (unchanged)

**Primary Dependencies**: none at runtime; WebLLM is not a dependency (engine injected; types
declared locally, minimal)

**Storage**: N/A

**Testing**: `node:test` (existing + new), Playwright (006, unchanged), real browsers (Chrome
Prompt API; WebLLM 0.2.85 + `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`)

**Target Platform**: Chrome Prompt API; WebGPU browsers for WebLLM

**Project Type**: library (single package)

**Performance Goals**: none; Chrome ordering unchanged (sync `destroy()` stays synchronous; only a returned promise is awaited, see research D7)

**Constraints**: FR-620 non-goals; core has no provider vocabulary; Chrome behavior identical

**Scale/Scope**: core ≈ +15 / −12; `src/browser/runtime.ts` ≈ +8; `src/webllm/runtime.ts` ≈ 70;
tests: harness edits + ~3 core tests + `test/webllm.test.ts` (~120) + boundary tokens;
`smoke/webllm.*` (~150); `experiments/webllm/EVIDENCE.md`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Small Core | ✅ | Core loses Chrome specifics; gains no concept |
| II. Browser Native First | ✅ | Chrome native clone kept; WebLLM native engine/request, no synthetic session |
| III. Benchmark Driven | ✅ | No performance claim |
| IV. Minimal Overhead | ✅ | Chrome: no wrapper, +1 microtask; WebLLM: one small task object per task (needed for drain) |
| V. Explicit Lifecycle | ✅ | Async cleanup awaited; deterministic order task → base → resolve |
| VI. Context Safety | ✅ | Per-task isolation: Chrome clone, WebLLM per-request messages (E1) |
| VII. Framework Agnostic | ✅ | Unchanged |
| VIII. Provider Extensibility Without Premature Abstraction | ✅ | Seam derived from exactly two real providers' evidence; internal until 008 |
| IX. Native Features Before Reinvention | ✅ | Uses WebLLM's own lock/interrupt/unload; no provider queue |
| X. Scope Discipline | ✅ | FR-620 exclusions honored |
| XI. Reliability Over Feature Count | ✅ | Cancellation isolation by construction (limit 1 + AkariSP queue) |
| XII. Public API Stability | ✅ | No public change; 8 root exports unchanged |

**Post-design re-check**: ✅ All gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/007-second-provider-validation/
├── plan.md
├── research.md                 # D1–D8
├── data-model.md               # lifecycle + provider mapping
├── contracts/internal-provider.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── core/runtime.ts        # Session (no clone, async destroy), SessionProvider<B> {create,start,broken,destroy},
│                          # acquire → provider.start/broken, async end, awaited base destroy
├── browser/runtime.ts     # NativeSession type, promptApi: start=clone, broken=moved predicate, destroy=base.destroy
├── webllm/runtime.ts      # NEW internal: createWebLLMRuntime(engine, options); not exported from root
└── index.ts               # unchanged (8 public names)
test/
├── runtime.test.ts        # harness provider → new seam; + clone-less + async-order tests
├── browser.test.ts        # + Chrome broken predicate (moved from core)
├── webllm.test.ts         # NEW: fake v0.2.85-like engine
└── boundary.test.ts       # + forbid clone / InvalidStateError / webllm import in core
smoke/
├── webllm.html, webllm.js # NEW: real WebLLM validation (9 checks)
└── results/               # + WebLLM validation JSON
experiments/webllm/
└── EVIDENCE.md            # NEW: per-experiment metadata table (FR-618)
```

**Structure Decision**: one new source module per provider area; no shared helper module (two
providers share only the core seam).

## Design Notes

### Core edits (all in `src/core/runtime.ts`)

| Site | Change |
|---|---|
| types | `Session` drops `clone`, `destroy(): void \| Promise<void>`, options `{ signal: AbortSignal }`; `SessionProvider<B>` gets `start`, `broken`, `destroy`; `createCoreRuntime<B>` |
| `bases` | `Map<string \| undefined, B>`; rollback `await provider.destroy?.(b)` each in try/catch; no `close` on rollback |
| `acquire` | `task = await provider.start(base, { signal: sig })`; broken if `!sig.aborted && provider.broken(e)` (the ponytail note about InvalidStateError moves to the browser module) |
| `end` | `async`: `try { await task?.destroy(); } catch {}` → `release()` → total |
| `run` | `finally { await end(...) }` |
| stream cleanup | `await end(...)` inside the existing single-flight promise |
| `shutdown` | after idle: `await provider.destroy?.(b)` per base, then `await provider.close?.()`, each in try/catch |
| doc comments | "clone" → "task session" wording (Runtime, RuntimeOptions.limit, snapshot) |

Unchanged: validation, `pick`, `admit`, `release`, `drain`, `failure`, snapshot, closing/idle,
TaskError/TaskTiming, public types' shapes.

### WebLLM lifecycle (normative, research D5)

```text
AkariSP queue → single task admitted (limit 1) → start: getMessage() probe
→ streaming request (manual next(); never for-await over the native iterator)
→ normal completion
   or abort / timeout / early break / shutdown
→ task.destroy(): first next() if never pulled → interruptGenerate() → drain to done
→ task cleanup resolved → slot released → next task
shutdown: closed → reject queued → abort active → active drain completes → idle
→ (no per-template cleanup) → close(): await engine.unload() once → resolve
ownership: engine exclusive to the runtime after successful creation; untouched if creation fails
broken: start health check only (getMessage); mid-generation fatal errors fail the task and are
detected at the next start (research D4)
```

### Key validation question

Does the seam keep Chrome's native clone without a wrapper and express WebLLM without a fake
clone? **Yes.** On Chrome, the object returned by `base.clone()` is the task `Session` itself
(D3). On WebLLM, `start` returns a request-execution object that owns exactly the cleanup the
evidence requires (drain), and nothing clones anything (D5, D6).

### Regression risk

- **Microtask shift (resolved at the T005 gate):** `end()` stays synchronous for a synchronous
  `destroy()`, so Chrome has 0 extra microtasks (research D7).
- *(original note)* **Microtask shift (medium):** awaiting Chrome's synchronous `destroy()` adds one microtask
  before slot release. The existing timing-sensitive tests are the gate, and any failure is
  investigated, never relaxed.
- **Harness adaptation (low):** only the fake provider object changes shape; assertions do not.
- **Broken stage (low):** still start-only, so Chrome is identical. WebLLM broken relies on the
  start probe (D4).
- **Pre-pull cancellation latency (medium):** cleanup waits up to one time-to-first-token.
  Covered by the slow-first-token fake test; the latency is recorded, not hidden.
- **Async rollback (medium):** the 004 contract is kept with async `destroy`. A dedicated test
  checks that `destroy` rejections do not mask the original error.
- **WebLLM fake fidelity (medium):** the fake must reproduce the v0.2.85 lock and interrupt
  semantics observed in E3–E6b. The real `smoke/webllm.html` run is the final judge.

## Test Strategy

1. **Baseline:** 105 tests, `tsc`, build, Playwright 21, Chrome smoke evidence (006).
2. **Core seam and harness adaptation:** the existing suites pass with no assertion change.
   Then add the clone-less provider test and the async cleanup-order test.
3. **Browser module moved to the seam:** add the Chrome predicate tests to `browser.test.ts`.
4. **WebLLM module and `test/webllm.test.ts`.**
5. **Boundary tokens.**
6. **Real browsers:** Chrome `smoke/streaming.html` (7/7), then `smoke/webllm.html` (9/9).
7. **Evidence:** `experiments/webllm/EVIDENCE.md`, plus final verification (public exports
   unchanged, 0 runtime dependencies, no fake clone).

## Complexity Tracking

No constitution violations; section intentionally empty.
