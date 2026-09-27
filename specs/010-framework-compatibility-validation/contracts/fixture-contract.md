# Contract: validation application (fixture) interface

AkariSP gains no interface in this feature. This is the contract between the four fixtures and
the automated spec, so that one spec can drive all four. It is test-only and never published.

## Page structure (every fixture)

| Element | Role |
|---|---|
| `#toggle` | Parent button that mounts/unmounts the owner component (starts mounted) |
| `#run` | In the owner: `await runtime.run('hi')`; writes output to `#out` |
| `#stream` | In the owner: iterates `runtime.stream('hi')`, appending chunks to `#out` |
| `#state` | In the owner: text of `runtime?.state ?? 'none'` after each action |
| `#out` | Output text |

Next.js also has the route `/other` (link `#to-other`, and back via `#to-home`), plus
`/server-import` and `/server-create` (R6).

## Console lines (fixture code, all modes)

| Line | When |
|---|---|
| `akarisp:create` | After `createRuntime()` resolves in the owner |
| `akarisp:shutdown` | After `runtime.shutdown()` resolves in the owner |

These are ordinary application logging with the existing API only. No AkariSP API is added.

## Stand-in (`fixtures/standin.js`, injected by the automated spec only)

The stand-in defines `globalThis.LanguageModel`:

```text
create(options?)               → base;                              __akari.creates++
base.clone({signal})           → task;                              __akari.clones++
base.destroy()                 → __akari.destroys++
task.prompt(input, {signal})   → 'ok'
task.promptStreaming(input, {signal})
                               → async iterable; yields 'a', 'b', then waits while __akari.hold is true
task.destroy()                 → __akari.cloneDestroys++
```

`__akari.createDelay` (ms, default 0) delays `create()` so that a test can unmount while
creation is still pending (the T014 pending-unmount check).

Semantics follow the 001–007 Prompt API usage: `clone` honours an aborted signal, and
`promptStreaming` ends with the abort reason when aborted.
