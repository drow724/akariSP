# AkariSP

A small runtime for browser-native LLM sessions (Chrome's Prompt API). It keeps one warm
**base session** and runs each task in its own **clone**, so repeated tasks don't pay session
creation every time and never share conversational context.

Zero runtime dependencies. No framework, no agent abstraction.

## Install

```bash
npm install akarisp
```

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

## States

- `ready`: accepts tasks.
- `broken`: a clone failed with `InvalidStateError`, so the base can no longer be trusted for
  new tasks. Waiting and new tasks are rejected; tasks already holding a clone finish normally.
  Create a new runtime.
- `closed`: after `shutdown()`. `shutdown()` is idempotent and never rejects.

## Performance

AkariSP **amortizes** session initialization across repeated tasks; it does not eliminate it.
The base session is created once (`createRuntime`), after which each task pays a clone instead
of a full `LanguageModel.create()`. Measure it on your device with the benchmark in
[bench/README.md](bench/README.md).

## Development

```bash
npm test       # node:test against a fake LanguageModel (Node ≥ 22.18)
npm run build  # tsc → dist/
```
