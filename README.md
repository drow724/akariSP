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

For the `0.1.0-alpha.2` release, both `alpha` and `latest` are intended to point to
`0.1.0-alpha.2`, so `npm install akarisp` and `npm install akarisp@alpha` install the same
version. This does not define a permanent dist-tag policy. Each release records its intended and
verified tags under [`releases/`](releases/).

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

## Using with frameworks

AkariSP needs no framework-specific package. The component (or page) that creates a runtime
owns it and calls `shutdown()` when it goes away. One rule matters in every framework:
**`createRuntime()` is asynchronous, so the owner can be unmounted before it resolves.** A runtime
that resolves after unmount must still be shut down. Otherwise it is never cleaned up. This
happens in production on a fast unmount, and on every mount under React's development
StrictMode.

React (`useEffect`; the same pattern works for a Next.js client component):

```jsx
useEffect(() => {
  let rt;
  let cancelled = false; // set by cleanup; a runtime resolving afterwards is shut down at once
  createRuntime().then((r) => {
    if (cancelled) {
      r.shutdown();
      return;
    }
    rt = r;
    setRuntime(r);
  });
  return () => {
    cancelled = true;
    rt?.shutdown();
  };
}, []);
```

- **Vue**: create in `onMounted`, and in `onBeforeUnmount` set `cancelled = true` and shut down.
  Then check `cancelled` after `await createRuntime()`.
- **Svelte**: the same pattern as React, inside `onMount` and the cleanup function it returns.
- **Next.js (App Router)**: importing `akarisp` from server components is safe. **Create the
  runtime only in client code**: a component marked `"use client"`, inside an effect. Creating
  it in server-evaluated code fails with `ReferenceError: LanguageModel is not defined`.

Development module replacement (HMR) caused no leaks in the tested versions. Validated with
React 19.3, Vue 3.5, Svelte 5.57, Vite 8.3, and Next.js 16.3. The full applications are in
[`fixtures/`](fixtures/), and the evidence is in
[`specs/010-framework-compatibility-validation`](specs/010-framework-compatibility-validation/research.md).

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
RELEASE=<version> npm run test:registry  # on demand, needs the network: the published package vs releases/<version>.json
npm run test:frameworks  # on demand, needs the network: React/Vue/Svelte + Vite and Next.js fixtures, installed from npm
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

Each release states its intent before publishing and verifies the registry afterwards. Nothing
relies on a configured default tag: with npm 10.9.2, a configured `publishConfig.tag` was
observed not to be applied, so the tag is always named on the command line.

1. Bump `version`, and write and commit `releases/<version>.json`, which names every intended
   dist-tag target.
2. Publish: `npm publish --tag <tag>` (`prepack` rebuilds `dist/` first).
3. For every other tag in the intent: `npm dist-tag add akarisp@<version> <tag>`.
4. Verify: `RELEASE=<version> npm run test:registry`. It re-reads the registry for up to 10
   minutes while metadata propagates, then installs from the registry into clean consumers.
   Commit the resulting `releases/<version>.verified.json`. It records one verification moment
   and is not a golden file. Re-running the check for an older release after the tags have moved
   overwrites it with a (correct) mismatch record. The committed release-time file is the
   evidence, so discard such a rewrite with `git checkout -- releases/<version>.verified.json`.
5. On a mismatch, fix forward: correct a tag with `npm dist-tag add` and re-run the check, or
   publish the next version for a content defect. Never unpublish.
