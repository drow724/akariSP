# Contract: `akarisp` public API (first-release freeze candidate)

The authoritative, machine-checked form is `api/akarisp.api.txt` (R8). This file is the
human-readable contract. It lists everything a consumer can import. Anything not listed here is
internal and is not importable.

## `akarisp`

```ts
export function createRuntime(options?: RuntimeOptions): Promise<Runtime>;

export class TaskError extends Error {
  readonly code: 'failed' | 'cancelled' | 'rejected' | 'closed' | 'broken';
  readonly timing: TaskTiming;
  // cause: original error or abort reason (standard Error.cause)
}

export interface RuntimeOptions {
  session?: object;                    // passed unchanged to the provider for the default template
  templates?: Record<string, object>;  // name → provider config; fixed for the runtime's lifetime
  limit?: number;                      // integer ≥ 1, default 1
  queueCapacity?: number;              // integer ≥ 0, default 32
}

export interface Runtime {
  readonly state: 'ready' | 'broken' | 'closed';
  run(input: string | readonly object[], options?: { signal?: AbortSignal; template?: string }): Promise<TaskResult>;
  stream(input: string | readonly object[], options?: { signal?: AbortSignal; template?: string }): TaskStream;
  snapshot(): RuntimeSnapshot;
  shutdown(): Promise<void>;
}

export interface RuntimeSnapshot {
  readonly state: Runtime['state'];
  readonly active: number;
  readonly queued: number;
  readonly limit: number;
  readonly queueCapacity: number;
}

export interface TaskStream extends AsyncIterable<string> {
  readonly timing: TaskTiming | undefined;
}

export interface TaskResult { output: string; timing: TaskTiming }

export interface TaskTiming { queueWait?: number; acquire?: number; prompt?: number; total: number }
```

## `akarisp/webllm`

```ts
export function createWebLLMRuntime(engine: WebLLMEngine, options?: RuntimeOptions): Promise<Runtime>;
```

`WebLLMEngine` is structural and not importable. An `MLCEngine` from `@mlc-ai/web-llm` 0.2.85
satisfies it:

```ts
interface WebLLMEngine {
  chat: { completions: { create(request: object): Promise<AsyncIterable<Chunk>> } };
  interruptGenerate(): void | Promise<void>;
  getMessage(): Promise<string>;
  unload(): Promise<void>;
}
```

Rules:

- The application creates and loads the engine. AkariSP never downloads a model.
- `limit > 1` → `TypeError` at creation, and the engine is untouched.
- Once creation resolves, the runtime uses the engine exclusively. `shutdown()` unloads it after
  every task's cleanup. If creation rejects, the engine is untouched.
- `broken`: the engine was unloaded or lost when a task started (`ModelNotLoadedError`,
  `DeviceLostError`).

## Not importable

`akarisp/core`, `akarisp/browser`, `akarisp/internal`, `akarisp/dist/*`, `akarisp/src/*`,
`akarisp/package.json`. This holds at runtime (`ERR_PACKAGE_PATH_NOT_EXPORTED`) and for types.

## Compatibility

- **Module format:** ESM only.
- **TypeScript:** `moduleResolution` `bundler`, `node16`, and `nodenext` are verified.
  `node10` is not supported.
- **Dependencies:** zero runtime dependencies.
- **Release:** version `0.1.0-alpha.0`, dist-tag `alpha`. Install it with
  `npm install akarisp@alpha`.
