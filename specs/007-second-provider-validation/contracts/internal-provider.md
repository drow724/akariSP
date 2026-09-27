# Contract: Internal Provider Seam (not public; revisited in 008)

```ts
// src/core/runtime.ts
export interface Session {
  prompt(input: Prompt, options: { signal: AbortSignal }): Promise<string>;
  promptStreaming(input: Prompt, options: { signal: AbortSignal }): AsyncIterable<string>;
  destroy(): void | Promise<void>;
}
export interface SessionProvider<B> {
  create(config?: object): Promise<B>;
  start(base: B, options: { signal: AbortSignal }): Promise<Session>;
  broken(error: unknown): boolean;
  destroy?(base: B): void | Promise<void>;   // per-template resource
  close?(): void | Promise<void>;            // provider-wide shared resource
}
export async function createCoreRuntime<B>(provider: SessionProvider<B>, options?: RuntimeOptions): Promise<Runtime>;
```

Obligations:
- `start` rejects with the provider's native error; the core consults `broken` only for `start`
  rejections and only when the task signal is not aborted.
- `Session.destroy()` resolves only when the provider can serve the next task; the core releases
  the slot after it settles (rejection swallowed).
- `destroy(base)` resolves when that per-template resource is released; called after every task
  has been destroyed (shutdown) or during creation rollback.
- `close()` resolves when provider-wide resources are released; called once, by shutdown only,
  after every `destroy(base)`. Never called when runtime creation fails.
- `broken` covers `start` rejections only; execution-stage failures are `failed` (007 adds no
  execution-stage promotion).
- Streams: an interrupted/aborted execution must reject or throw (never finish as success).

WebLLM internal entry (not exported from the package root):

```ts
// src/webllm/runtime.ts
export function createWebLLMRuntime(engine: WebLLMEngine, options?: RuntimeOptions): Promise<Runtime>;
// options.limit > 1 → rejects TypeError before any provider work
```

Engine ownership (007): the application creates the engine; after `createWebLLMRuntime`
resolves, the runtime uses it exclusively (the caller must not generate on it) and unloads it
at shutdown; if creation fails, the engine is untouched and not unloaded. 008 may redesign
ownership.

## Public API: unchanged

Root exports stay the 8 names from 004–006; `createRuntime(options)` still creates a Chrome
runtime. No public change is required by the evidence (FR-619). `Runtime` doc comments are
reworded from "clone" to "task session" wording only.
