# Data Model: Second Provider Validation

No new runtime state. The core keeps `state`, `running`, `queue`, `closing`, `idle`, `closer`,
`bases` exactly as today; only the type of a base becomes opaque (`B`).

## Lifecycle (both providers, core-owned policy)

```text
createCoreRuntime(provider, options)
  validate options → for each template (default first, key order): base = await provider.create(config)
  on a create rejection: await provider.destroy?.(b) for each created base (errors swallowed) → rethrow
                         (no close(): ownership of provider-wide resources was never taken)
task (run / first stream pull)
  pick(template) → admit (slot or FIFO wait) → task = await provider.start(base, { signal })
    start rejects: !signal.aborted && provider.broken(e) → runtime broken (drain queue) : failed / cancelled
  → task.prompt / task.promptStreaming (signal)
  → end: await task.destroy() (errors swallowed) → release slot → timing.total
shutdown
  closed → reject queued → abort running → await idle (every task destroyed, slots released)
  → await provider.destroy?.(b) for each base, sequentially → await provider.close?.() → resolve
  (one shared promise)
```

## Provider mapping

| Contract member | Chrome (`src/browser`) | WebLLM (`src/webllm`, internal until 008) |
|---|---|---|
| base `B` | native warm session per template | the template config object (engine shared) |
| `create(config)` | `LanguageModel.create(config)` | returns `config` (no loading) |
| `start(base, {signal})` | `base.clone({signal})` → native session | `await engine.getMessage()` probe → per-task execution object |
| `Session.prompt` | native | accumulate the streaming path |
| `Session.promptStreaming` | native | single request; manual `next()`; abort → `interruptGenerate()`; throws `signal.reason` if interrupted |
| `Session.destroy()` | native (sync) | if unfinished: first `next()` if never pulled → `interruptGenerate()` → drain to done (called once per task by the core's `end()`; no single-flight guard) |
| `broken(e)` (start rejections only) | `e instanceof DOMException && e.name === 'InvalidStateError'` | `e.name` is `ModelNotLoadedError` or `DeviceLostError`; mid-generation failures are not promoted (detected at the next start) |
| `destroy(base)` | `base.destroy()` | — (a config holds no resource) |
| `close()` | — | `await engine.unload()` once, after all tasks; only at shutdown |
| ownership | runtime creates and owns its sessions | application creates the engine; runtime uses it exclusively after successful creation and unloads it at shutdown; failed creation leaves it untouched |
| concurrency | `limit` ≥ 1 | `limit` must be 1 (TypeError otherwise, before any provider work) |
