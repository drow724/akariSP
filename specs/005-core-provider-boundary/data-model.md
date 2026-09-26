# Data Model: Core / Browser Provider Boundary

No new runtime state. All 001–004 state (`state`, `running`, `queue`, `closing`, `idle`,
`closer`, `bases`) stays in core, unchanged. This feature adds two internal types and moves one
declaration.

## SessionProvider (core, internal)

| Member | Type | Notes |
|---|---|---|
| `create(config?)` | `(config?: object) => Promise<Session>` | Called by core only during `createCoreRuntime`, sequentially, default first then templates in key order (004). Receives the `session` / template config object unchanged (same identity). Never receives a template name. |

## Session (core, internal; unchanged from 004)

| Member | Type | Called by core in |
|---|---|---|
| `clone(options?)` | `({ signal? }) => Promise<Session>` | `acquire` (on the selected base) |
| `prompt(input, options?)` | `(Prompt, { signal? }) => Promise<string>` | `run` |
| `promptStreaming(input, options?)` | `(Prompt, { signal? }) => AsyncIterable<string>` | `stream` |
| `destroy()` | `() => void` (synchronous) | `end` (task), creation rollback (bases), `shutdown` (bases) |

Error convention (unchanged, exact): a `clone` rejection with
`e instanceof DOMException && e.name === 'InvalidStateError'`, while the task signal is not
aborted, moves the runtime to `broken`. Not generalized to name-only in 005.

Native browser sessions satisfy this contract structurally and are passed to the core unwrapped;
the browser integration adapts only `create`.

## Ownership

```text
createRuntime(options)            src/browser/runtime.ts   (public)
  └─ createCoreRuntime(promptApi, options)   src/core/runtime.ts (internal)
        ├─ promptApi.create(config) → LanguageModel.create(config)   (only browser call)
        └─ native Session objects used directly via the Session contract
```

Source dependencies:

```text
src/index.ts
 ├─> src/browser/runtime.ts
 └─> src/core/runtime.ts   // TaskError and public type re-export

src/browser/runtime.ts
 └─> src/core/runtime.ts
```

Invariants: core → browser = 0; core → `LanguageModel` = 0. The direct `index → core`
re-export is allowed. `src/core` imports nothing.
