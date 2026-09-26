# Contract: AkariSP v0.4 Public API (delta from v0.3)

v0.3 contract: `specs/003-runtime-snapshot/contracts/public-api.md`. Unchanged except below.

```ts
export interface RuntimeOptions {
  /** Passed unchanged to LanguageModel.create() for the unnamed default template. */
  session?: object;
  /** Named templates: name → options passed unchanged to LanguageModel.create(). Fixed for the
   *  runtime's lifetime. If given without `session`, there is no default template. */
  templates?: Record<string, object>;
  limit?: number;
  queueCapacity?: number;
}

export interface Runtime {
  run(input: Prompt, options?: { signal?: AbortSignal; template?: string }): Promise<TaskResult>;
  stream(input: Prompt, options?: { signal?: AbortSignal; template?: string }): TaskStream;
  // state, snapshot, shutdown unchanged
}
```

## Behavior contract

| Situation | Result |
|---|---|
| `createRuntime()` / `{ session }` (no templates) | Unchanged from v0.3 |
| `{ templates: {} }` without `session` | Rejects `TypeError`; no `create()` call |
| A template's `create()` rejects | Rejects with that error; bases already created are destroyed |
| `run(input, { template: 'a' })` | Clones template `a`'s base |
| `run(input)` with a default base | Clones the default base |
| `run(input)` with templates and no `session` | Rejects `TypeError`; no admission |
| `run(input, { template: 'nope' })` | Rejects `TypeError`; no admission |
| `stream(input, { template })` | Lazy; the same resolution and `TypeError` at the first pull, before admission |
| Tasks on different templates | Share one limit and one FIFO queue |
| Clone `InvalidStateError` on any template | Runtime `broken` (all templates), as in v0.1 |
| `shutdown()` | Destroys every base exactly once after task cleanup |
| `snapshot()` | Unchanged, runtime-wide |

## Unchanged

`createRuntime` signature, `TaskError` (no new codes), `TaskTiming`, `TaskStream`,
`TaskResult`, `RuntimeSnapshot`, `state`. New public fields: `RuntimeOptions.templates` and the
`template` task option. No new exported names.
