# Data Model: Public Surface Review

The "entities" of this feature are the items of the public surface. Every item gets exactly one
decision (FR-805) and a reason checked against the eight review questions (FR-806): naming,
provider leakage, specificity, necessity, read-only-ness, optional/default semantics, error
semantics, and robustness against the two evidenced providers (Chrome Prompt API, WebLLM 0.2.85).

## Entry points

| Entry | Exports (values / types) | Decision |
|---|---|---|
| `akarisp` | `createRuntime`, `TaskError` / `Runtime`, `RuntimeOptions`, `RuntimeSnapshot`, `TaskStream`, `TaskResult`, `TaskTiming` | keep (8 names) |
| `akarisp/webllm` | `createWebLLMRuntime` / — | new (1 name), Clarification Q1 |
| any other path | — | not importable (runtime and types) |

Total public names: 9.
- The only addition is `createWebLLMRuntime`, justified by Clarification Q1 and 007's
  real-browser evidence (SC-808).
- Internal and not importable: `SessionProvider`, `Session`, `createCoreRuntime`, and
  `WebLLMEngine` (FR-807; R1).

## Item review

| Item | Decision | Reason |
|---|---|---|
| `createRuntime(options?)` → `Promise<Runtime>` | keep | Chrome factory; the name matches the root import users expect. Provider-specific by design; its return type is neutral |
| `createWebLLMRuntime(engine, options?)` → `Promise<Runtime>` | new | Provider-specific factory, provider-neutral result. `engine` is structural (R2). Throws `TypeError` if `limit > 1` |
| `engine.interruptGenerate()` in the structural engine contract | **change: `void \| Promise<void>`** (was `Promise<void>`) | Public structural input contract. T011: WebLLM 0.2.85 declares `void` on `MLCEngineInterface` and `WebWorkerMLCEngine` (`Promise<void>` only on the `MLCEngine` class), so the narrower type rejected real engines. The adapter already awaits the call; no runtime change |
| `Runtime.state` (`'ready' \| 'broken' \| 'closed'`) | keep | Neutral. `broken` = the provider's resource can no longer be trusted; the cause is provider-specific and documented per provider |
| `Runtime.run(input, { signal?, template? })` → `Promise<TaskResult>` | keep | Neutral. The options type stays anonymous (R4) |
| `Runtime.stream(input, { signal?, template? })` → `TaskStream` | keep | Neutral; lazy, single use |
| `Runtime.snapshot()` → `RuntimeSnapshot` | keep | Neutral; synchronous |
| `Runtime.shutdown()` → `Promise<void>` | keep | Neutral; resolves after all provider cleanup, which includes WebLLM unload |
| `input` (`string \| readonly object[]`) | keep | Both providers accept a string or a message list. The type alias stays unexported |
| `RuntimeOptions.session?: object` | keep | Neutral: "passed unchanged to the provider". Chrome: `LanguageModel.create()` options. WebLLM: `initialPrompts` plus request settings. `object` is deliberately loose because the two providers take different configuration shapes |
| `RuntimeOptions.templates?: Record<string, object>` | keep | Same as `session`. Fixed for the runtime's lifetime |
| `RuntimeOptions.limit?: number` (default 1) | keep | Neutral; WebLLM additionally requires 1 (documented) |
| `RuntimeOptions.queueCapacity?: number` (default 32) | keep | Neutral |
| `RuntimeSnapshot.{state, active, queued, limit, queueCapacity}` | **change: `readonly`** | Documented as a read-only view, but the type allowed writes (R4) |
| `TaskStream` (`AsyncIterable<string>` + `readonly timing`) | keep | Neutral |
| `TaskResult.{output, timing}` | keep | Caller-owned result record |
| `TaskTiming.{queueWait?, acquire?, prompt?, total}` (ms) | keep | Neutral phase names. `acquire` = start of the task's provider execution (a clone on Chrome, a request start on WebLLM). Mutable in the type (R4) |
| `TaskError` (`code`, `timing`, `cause`, `name = 'TaskError'`) | keep | Needed for `instanceof`. The constructor stays public (a class cannot hide it); the README does not document constructing one |
| `TaskError.code` `'failed' \| 'cancelled' \| 'rejected' \| 'closed' \| 'broken'` | keep | Each code maps to one documented cause, and the same codes hold on both providers (007: 9/9) |

## Package metadata (entity: packed artifact)

| Field | Before | After |
|---|---|---|
| `version` | `0.1.0` | `0.1.0-alpha.0` |
| `exports` | `"."` | `"."`, `"./webllm"` |
| `publishConfig.tag` | — | `alpha` |
| `license` / `repository` | — | `Apache-2.0` / GitHub URL |
| `engines` | `node >= 22.18` | removed (development requirement, documented in the README) |
| `scripts.prepack` | — | `npm run build` |
| `dependencies` | none | none |

Tarball allow-list (13 files): `LICENSE`, `README.md`, `package.json`, and
`dist/index.{js,d.ts}`, `dist/webllm.{js,d.ts}`, `dist/core/runtime.{js,d.ts}`,
`dist/browser/runtime.{js,d.ts}`, `dist/webllm/runtime.{js,d.ts}`.

## Invariants (must not change in 008)

- Lifecycle semantics of 001–007 (FR-808). 008 changes types, packaging, and documentation
  only. None of the intentional public type changes has a runtime effect:
  - `RuntimeSnapshot` fields → `readonly`;
  - `akarisp/webllm` → the `createWebLLMRuntime` public entry;
  - WebLLM engine structural contract: `interruptGenerate(): void | Promise<void>` (T011
    evidence).
- Chrome: native base session, `start = clone`, `InvalidStateError` → broken inside the Chrome
  provider only.
- WebLLM: config base, streaming-only requests, first `next()` → interrupt → drain, `close =
  unload`, `limit = 1`.
