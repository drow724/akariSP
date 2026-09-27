# Prompt API broken-state classification: pre-feature research

Candidate: `012-prompt-api-broken-state-classification-validation`. Researched 2026-09-27.

**Decision: DEFER FEATURE 012 — REAL-BROWSER EVIDENCE INSUFFICIENT.** No spec was created, and
feature number 012 stays free. Production change: 0.

## Question

Does the Prompt API provider's rule `broken: (e) => e instanceof DOMException && e.name ===
'InvalidStateError'` still track whether the warm base can start later independent tasks?

## Current AkariSP path (STATIC_CODE_ANALYSIS)

`run()`/`stream()` → `admit()` → `acquire()` → `provider.start(base)` = `base.clone({ signal })`
(`src/core/runtime.ts:184-203`, `src/browser/runtime.ts`).

- `provider.broken(e)` is consulted **only** when `start()` rejects **and** the task signal (caller
  signal combined with the shutdown signal) is not aborted. It is never consulted for `prompt()`,
  `promptStreaming()`, `create()`, or `destroy()` errors.
- `broken(e) === true`: state `ready → broken`, the queue is drained with `TaskError('broken')`
  (no cause), the current task rejects `TaskError('broken', cause: e)`. Later `run()`s reject at
  admission with `broken` and never clone. Running tasks keep their own clone and complete. Bases
  are **not** destroyed until `shutdown()`, which still destroys them and resolves.
- `broken(e) === false`: the task rejects `TaskError('failed', cause: e)`; the runtime stays
  `ready`; the next queued task clones again.
- Aborted task: `TaskError('cancelled', cause: signal.reason)`, `broken()` skipped.
- Tests: `test/runtime.test.ts` ("clone InvalidStateError: broken…", "clone error named
  InvalidStateError but not a DOMException…", "broken under concurrency…", "templates: broken is
  runtime-wide…", "broken is delegated to provider.broken, consulted only for start rejections"),
  `test/browser.test.ts` ("Chrome broken rule…" ×2). They protect the historical contract, not its
  match with the platform.

## Historical rationale (HISTORICAL_EXISTING_EVIDENCE)

001 research R2 chose `InvalidStateError` because the spec rejects `clone()` with it for a
non-fully-active Document and Chrome used it for unusable sessions; other names may be transient.
Known ceiling: "revisit if the spec defines destroyed-session behavior explicitly." 005 B4 kept
the check byte-identical (including `instanceof DOMException`, to reject lookalikes).

## Platform contract

PLATFORM_SPECIFICATION — `webmachinelearning/prompt-api` `9fcb9a4` (2026-09-24) and
`writing-assistance-apis` `dd37ddd` (2026-08-10), read 2026-09-27:

| Situation | Specified `clone()` result |
|---|---|
| Document not fully active | `InvalidStateError` `DOMException` (checked first) |
| Model destroyed by `destroy()` | rejected with the destruction reason: a new `AbortError` `DOMException` |
| `create({ signal })` aborted after creation | model destroyed with `signal.reason` (caller-supplied, any value); later `clone()` rejects with it |
| `clone({ signal })` already aborted / aborted during clone | rejected with that signal's reason |
| Copy of state fails | `OperationError` `DOMException` |

`prompt()`/`promptStreaming()` follow the same order (fully active → destruction/operation signal).

PLATFORM_DOCUMENTATION — Chrome "Prompt API" (updated 2026-08-26): a destroyed session "can no
longer be used"; later calls reject "with an error explaining that the session is destroyed". The
`create()` `signal` is documented as a way "to destroy the session". No error name is given.

So the spec now defines destroyed-model errors, and they are **not** `InvalidStateError`: the
revisit condition from 001 R2 is met at the specification level.

## Stand-in (DETERMINISTIC_STAND_IN)

`standin.mjs` → `standin-results-2026-09-27.json`, Node 23.9, public entry `src/index.ts`.
Limit 1: A holds the slot, B and C queue, B's clone rejects with X, then D.

| X (clone rejection) | B | state | C | D | base destroyed before shutdown | shutdown |
|---|---|---|---|---|---|---|
| `DOMException` `InvalidStateError` | `broken` | `broken` | `broken`, no clone | `broken`, no clone | 0 | resolves, 1 destroy |
| `DOMException` `AbortError` / `OperationError` / `NotSupportedError` / `NetworkError` | `failed` | `ready` | `failed`, cloned | `failed`, cloned | 0 | resolves |
| `Error` | `failed` | `ready` | `failed`, cloned | `failed`, cloned | 0 | resolves |
| `{ name: 'InvalidStateError' }` | `failed` | `ready` | `failed`, cloned | `failed`, cloned | 0 | resolves |

The cause is always the original rejection value. Task-local aborts (before `run()`, while queued,
during clone even when the clone rejects `InvalidStateError`) all give `cancelled` with the
signal's reason, runtime `ready`, and the next task succeeds.

A stand-in of the **specified** destroyed model (clone rejects with the destruction reason) gives,
for `controller.abort()`, a custom reason, and `base.destroy()`: three consecutive `failed` runs
with runtime `ready`. This is AkariSP behavior under a spec-conformant provider, not observed native
behavior.

## Real browser (REAL_BROWSER)

`browser.html` + `browser.js` → `browser-results-2026-09-27.json`. Chrome 152 on macOS,
`availability() === 'available'` (the page refuses anything else; no download). Run by the
maintainer; values pasted unchanged. The built-in Claude browser (Chrome 152.0.7977.130) reported
`downloadable`, so it was not used.

| Scenario | Native error / reason | Base reusable afterward? | AkariSP `TaskError.code` | `runtime.state` | Classification correct? |
|---|---|---|---|---|---|
| Native `destroy()`, then `clone()` ×2, `prompt()` | `DOMException` `InvalidStateError` "The model execution session has been destroyed." (every call) | No (repeated) | NOT APPLICABLE (outside AkariSP); would be `broken` by the rule | — | Yes, in Chrome 152 |
| `create({ signal })`, `abort()` after creation (default and custom reason) | none: `clone()` keeps succeeding | Yes | none: 3/3 runs succeed | `ready` | Yes |
| Same through AkariSP `session.signal` | none | Yes | none: 3/3 runs succeed | `ready` | Yes |
| Detached iframe Document, native `clone()` ×2 | `DOMException` `InvalidStateError` "The execution context is not valid."; `destroy()` throws the same | No (repeated) | NOT APPLICABLE | — | — |
| Detached iframe Document behind AkariSP (instrumented) | same `InvalidStateError`, from the **iframe's realm** | No | `failed` ×2 | `ready` | **No** (see below) |

The instrumented case points the page's `LanguageModel` global at the iframe's one for a single
`create()`. The resulting `InvalidStateError` is an iframe-realm `DOMException`, so
`e instanceof DOMException` in AkariSP's realm is false. Confirmed separately in the built-in
browser: `new iframe.contentWindow.DOMException('x', 'InvalidStateError') instanceof DOMException`
is `false`, with name `InvalidStateError`. This false negative is caused by that cross-realm
setup. A same-realm detached-document case (AkariSP loaded inside the removed iframe) was **not**
tested: UNKNOWN (static reading suggests `broken`).

## Base reusability

| Failure | Same base can clone again? | Evidence |
|---|---|---|
| Destroyed base (Chrome 152) | No | REAL_BROWSER |
| Destroyed base (spec) | No | PLATFORM_SPECIFICATION |
| Create signal aborted after creation (Chrome 152) | Yes, the base is not destroyed | REAL_BROWSER |
| Create signal aborted after creation (spec) | No | PLATFORM_SPECIFICATION |
| Detached Document | No, not even `destroy()` | REAL_BROWSER |
| Task-local abort | Yes | DETERMINISTIC_STAND_IN |
| Other clone errors | UNKNOWN natively | — |

## False positives

Did AkariSP mark a reusable runtime broken? **NO** observed. Every real `InvalidStateError` came
from a base that stayed unusable on every retry. Aborting a task never reaches `broken()`.

## False negatives

Did AkariSP leave a permanently unusable runtime ready? **Not in a supported setup.**

- **Chrome 152, same realm**: NO. A destroyed base rejects `InvalidStateError`, which the rule
  catches. The create-signal abort does not destroy the base, so `ready` is correct.
- **Spec-conformant browser**: YES by specification. A destroyed base rejects with `AbortError`
  or the caller's reason, and AkariSP would report `failed` repeatedly while staying `ready`. This
  is a specification contradiction, not a reproduced Chrome defect.
- **Cross-realm base (instrumented)**: YES, observed. It is outside supported use: AkariSP reads
  the `LanguageModel` global of its own realm.

## Documentation finding

The README's lifetime sentence says that aborting the create `signal` after creation "may
invalidate the native base session, so later tasks fail and the runtime becomes `broken`". It
came from the cold-start stand-in, which assumed `InvalidStateError`. Neither source supports the
`broken` half:

- Chrome 152 keeps the base usable, and the runtime stays `ready` and working.
- Under the spec, the base is destroyed but AkariSP reports `failed` and stays `ready`.

Severity **LOW**: documentation only, with no Chrome 152 malfunction. Corrected in the same change
as this research, at the maintainer's request: the README now states the specified and observed
behavior and that the runtime does not become `broken`.

## Minimum-change assessment

**Insufficient evidence** for a production change. If a browser ships the specified behavior,
the gap is provider-local: the Prompt API provider knows the destruction signal only through
`create()` options. Bookkeeping may then be needed, because the rejection value alone (for example
a caller's `Error`) cannot identify destruction. That design is not attempted.

## Revisit conditions

1. Chrome, or another shipping browser, rejects `clone()` on a destroyed model with something
   other than `InvalidStateError`, for example the specified abort reason.
2. Chrome makes `create({ signal })` abort destroy the created model, as specified.
3. A consumer runs AkariSP with a `LanguageModel` from another realm, or reports a runtime stuck
   in `ready` with repeated `failed`.
4. `prompt()`-time errors are shown to permanently invalidate the base (a separate concern; see
   below).

`prompt()` note: Chrome 152 rejects `prompt()` on a destroyed base with `InvalidStateError`, but
tasks prompt their own clone, never the base. Out of scope.

## Reproduce

```bash
# Stand-in (Node >= 22.18, repository root). Uses src/ directly.
node experiments/prompt-api-broken-state/standin.mjs > standin-results-<date>.json
```

```bash
# Real browser: Chrome with the Prompt API model already available.
npm run build
python3 -m http.server 8080
# Open http://localhost:8080/experiments/prompt-api-broken-state/browser.html, press Run, then Copy JSON.
```
