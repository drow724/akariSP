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
