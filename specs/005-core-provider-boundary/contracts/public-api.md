# Contract: Public API (unchanged) and Internal Provider Boundary

## Public API: identical to 004

Entry: `akarisp` (`package.json` `exports["."]` → `dist/index.js`, unchanged).

| Export | Kind | Change |
|---|---|---|
| `createRuntime(options?: RuntimeOptions): Promise<Runtime>` | value | none (now defined in `src/browser/runtime.ts`) |
| `TaskError` | value (class) | none (defined in `src/core/runtime.ts`) |
| `RuntimeOptions`, `Runtime`, `RuntimeSnapshot`, `TaskStream`, `TaskResult`, `TaskTiming` | types | none, except `RuntimeOptions` doc comments say "the session provider's create()" instead of `LanguageModel.create()` |

Not exported (verified by test and by `dist/index.d.ts`): `SessionProvider`, `Session`,
`createCoreRuntime`, the browser adapter object. No new entry points or subpath exports.

Behavior: every 001–004 contract unchanged, including validation order (limit / queueCapacity /
empty templates `TypeError`s before any `create()`), error codes and causes, timing fields,
snapshot fields, lazy streams, and shutdown.

## Internal contract (not public; for `src/browser` and tests only)

```ts
// src/core/runtime.ts
export interface Session {
  clone(options?: { signal?: AbortSignal }): Promise<Session>;
  prompt(input: Prompt, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming(input: Prompt, options?: { signal?: AbortSignal }): AsyncIterable<string>;
  destroy(): void;
}
export interface SessionProvider { create(config?: object): Promise<Session> }
export async function createCoreRuntime(provider: SessionProvider, options?: RuntimeOptions): Promise<Runtime>;
```

Stability: none promised. Feature 006 decides whether these become public after a second
provider exercises them.
