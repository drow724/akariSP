# AkariSP

A small runtime for browser-native LLM sessions (Chrome's Prompt API). It keeps one warm
**base session** and runs each task in its own **clone**, so repeated tasks don't pay session
creation every time and never share conversational context.

The same runtime also drives an application-created [WebLLM](#webllm) engine through
`akarisp/webllm`.

Zero runtime dependencies. No framework, no agent abstraction.

## Install

```bash
npm install akarisp@alpha
```

The first release, `0.1.0-alpha.0`, is published under the `alpha` dist-tag. A plain
`npm install akarisp` installs the `latest` tag, which will exist only after a stable release.

## Usage

```js
import { createRuntime, TaskError } from 'akarisp';

const runtime = await createRuntime({
  session: { initialPrompts: [{ role: 'system', content: 'Answer in one sentence.' }] },
  limit: 1,          // absolute cap on running tasks (default 1)
  queueCapacity: 32, // waiting tasks beyond the limit (default 32); overflow is rejected
});

try {
  const { output, timing } = await runtime.run('What is HTTP?', {
    signal: AbortSignal.timeout(10_000),
  });
  console.log(output, timing); // { queueWait, acquire, prompt, total } in ms
} catch (e) {
  if (e instanceof TaskError) {
    // e.code: 'failed' | 'cancelled' | 'rejected' | 'closed' | 'broken'
    // e.cause: original error or abort reason; e.timing: phases completed so far
  }
}

await runtime.shutdown(); // cancels running tasks, rejects waiting ones, destroys all sessions
```

Each `run()` clones the base, prompts the clone, and destroys it. The task's promise settles
only after its session is destroyed and its slot released.

## Streaming

```js
const stream = runtime.stream('Explain HTTP in two sentences.', {
  signal: AbortSignal.timeout(10_000),
});
for await (const chunk of stream) {
  output.textContent += chunk;
  if (userClickedStop) break; // clone destroyed and slot released before the loop exits
}
console.log(stream.timing); // final TaskTiming; undefined until the stream has fully ended
```

- Same limit, queue, cancellation, broken, and shutdown rules as `run()`; both share one queue.
- Lazy: nothing is queued or cloned until the first pull, so an unused stream costs nothing.
- Single use: iterating the same stream twice throws `TypeError`.
- `timing.prompt` runs until the loop sees the model's end; because chunks are pulled, it includes
  the time your loop body spends on each chunk.
- `break` is not an error. Cancellation, timeout, model failure, and shutdown end the loop with a
  `TaskError`, and cleanup happens even if you have stopped pulling chunks.

## Templates

One runtime can hold a small fixed set of named warm base sessions and clone the one each task
names:

```js
const runtime = await createRuntime({
  session: { initialPrompts: [{ role: 'system', content: 'General assistant.' }] }, // optional default
  templates: {
    momentum: { initialPrompts: [{ role: 'system', content: 'You analyze momentum.' }] },
    risk: { initialPrompts: [{ role: 'system', content: 'You analyze risk.' }] },
  },
  limit: 2,
});

await runtime.run(text, { template: 'momentum' });
for await (const chunk of runtime.stream(text, { template: 'risk' })) render(chunk);
await runtime.run(text); // uses the default `session` template
```

- Each template value is passed to `LanguageModel.create()`; the runtime creates and owns every base.
- With `session`, omitting `template` uses it. With only `templates`, you must name one; otherwise
  `run()` rejects and `stream()`'s first pull throws `TypeError`. Unknown names throw `TypeError`.
  Neither consumes a queue entry or slot.
- All templates share one `limit` and one queue. A clone failure that breaks any base makes the whole
  runtime `broken`. `shutdown()` destroys every base.

## Snapshot

```js
const { state, active, queued, limit, queueCapacity } = runtime.snapshot();
```

Synchronous and read-only: it never waits, admits, cancels, or changes anything, and each call
returns a fresh plain object. `active` counts tasks holding a concurrency slot, including a task
whose session is still being destroyed; `queued` counts tasks waiting for a slot (a stream counts
only after its first pull). After `await runtime.shutdown()` it reports `closed` with `0/0`.

## States

- `ready`: accepts tasks.
- `broken`: the provider's resource can no longer be trusted for new tasks. With the Prompt
  API, this means a clone failed with `InvalidStateError`. For WebLLM, see [WebLLM](#webllm). Waiting and new tasks are rejected; tasks already holding a clone finish normally.
  Create a new runtime.
- `closed`: after `shutdown()`. `shutdown()` is idempotent and never rejects.

## Performance

AkariSP **amortizes** session initialization across repeated tasks; it does not eliminate it.
The base session is created once (`createRuntime`), after which each task pays a clone instead
of a full `LanguageModel.create()`. Measure it on your device with the benchmark in
[bench/README.md](bench/README.md).

## WebLLM

```js
import { CreateMLCEngine } from '@mlc-ai/web-llm'; // your dependency, not AkariSP's
import { createWebLLMRuntime } from 'akarisp/webllm';

const engine = await CreateMLCEngine('Qwen2.5-0.5B-Instruct-q4f16_1-MLC'); // you load the model
const runtime = await createWebLLMRuntime(engine, {
  session: { initialPrompts: [{ role: 'system', content: 'Answer in one sentence.' }], temperature: 0 },
});
const { output } = await runtime.run('What is HTTP?');
await runtime.shutdown(); // also unloads the engine
```

The returned runtime is the same `Runtime`: `run`, `stream`, `snapshot`, `shutdown`, templates,
`TaskError` codes, and timing behave as above. What differs:

- **Engine**: your application creates the engine and loads the model. AkariSP never
  downloads a model and does not depend on `@mlc-ai/web-llm`.
- **Ownership**: once `createWebLLMRuntime` resolves, the runtime uses the engine exclusively
  (run nothing else on it), and `shutdown()` unloads it after every task's cleanup. If creation
  rejects, the engine is untouched.
- **`limit` must be 1**: one engine generates one request at a time. `limit > 1` throws
  `TypeError`. Extra tasks wait in AkariSP's queue, where cancelling one never affects another.
- **Templates** are request configuration: `initialPrompts` plus request settings such as
  `temperature`, all on the one engine. No per-template resource is created.
- **Tasks**: each task is one streaming request, also for `run()`. Cancellation, timeout,
  `break`, and shutdown interrupt the generation and drain it before the slot is released, so
  the next task starts cleanly.
- **`broken`**: the engine was unloaded or lost when a task started (`ModelNotLoadedError`,
  `DeviceLostError`). Create a new engine and runtime.
- **Validated**: with `@mlc-ai/web-llm` 0.2.85 and Qwen2.5-0.5B-Instruct in Chrome with WebGPU
  ([smoke/README.md](smoke/README.md)). Other WebLLM versions are unverified.
- **Types**: a `MLCEngine`, `WebWorkerMLCEngine`, or `MLCEngineInterface` is accepted without
  a cast. This is verified with TypeScript `moduleResolution: "bundler"`. WebLLM 0.2.85's own
  declarations do not resolve under `node16`/`nodenext`, where its types become `any`.

## Package

- Entry points: `akarisp` (`createRuntime`, `TaskError`, and the types `Runtime`,
  `RuntimeOptions`, `RuntimeSnapshot`, `TaskStream`, `TaskResult`, `TaskTiming`) and
  `akarisp/webllm` (`createWebLLMRuntime`). No other path is importable.
- ESM only. On Node 23.9, `require('akarisp')` also returns the same exports through Node's
  `require(esm)`; the package ships no CommonJS build.
- TypeScript declarations are included and verified with `moduleResolution` `bundler`,
  `node16`, and `nodenext`.
- Zero runtime dependencies.

## Development

Requires Node ≥ 22.18 (the test runner loads TypeScript directly). This is a development
requirement only; the package itself runs in browsers.

```bash
npm test       # node:test: core, browser and WebLLM adapters, boundary, packed-tarball consumer
npm run build  # tsc → dist/
npm run test:browser  # Playwright: compatibility page on Chromium / Firefox / WebKit engines
```

### Browser compatibility

AkariSP's browser integration uses the Prompt API exposed by the current browser. Importing
AkariSP is safe in any browser, but that does not mean the browser can run a local model, and
AkariSP cannot make the Prompt API available where the browser does not provide it. Use the
compatibility harness ([smoke/README.md](smoke/README.md)) to inspect the capabilities and
lifecycle behavior of a specific browser and version.

Source layout: `src/core/` is the provider-neutral runtime (no browser globals);
`src/browser/` maps it to the Prompt API's `LanguageModel`; `src/webllm/` maps it to an
injected WebLLM engine; `src/index.ts` and `src/webllm.ts` are the two public entries.

### Public API snapshot

`api/akarisp.api.txt` records the public surface of the packed package. `npm test` fails if the
surface changes. After an intentional public API change, run `UPDATE_API=1 npm test` and review
the diff.

### Release

`npm publish` uses `publishConfig.tag` (`alpha`), so a pre-release never lands on `latest` by
accident. `prepack` rebuilds `dist/` first.
