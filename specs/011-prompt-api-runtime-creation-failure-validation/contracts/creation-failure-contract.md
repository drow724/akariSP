# Contract: Prompt API runtime creation failures (existing, validated by 011)

Nothing in this contract is new. It records what 001, 004, and 005 established and what 011
verifies. The public API is unchanged.

| Condition | `createRuntime(options)` |
|---|---|
| Invalid options | rejects with `TypeError`. The Prompt API global is never read |
| Prompt API global absent | returns a promise that rejects with `ReferenceError: LanguageModel is not defined`. No synchronous throw, and nothing is created |
| `LanguageModel.create()` rejects | rejects with the provider's error, without AkariSP-specific translation, wrapping, or `TaskError` conversion. Bases already created for earlier templates are destroyed |
| Available | resolves to a `ready` runtime |

Rules that apply to every row:
- Importing `akarisp` or `akarisp/webllm` never reads the Prompt API global.
- AkariSP never calls `availability()`.
- `TaskError` is only for task outcomes.
- Error-object identity is current behavior and is checked by tests as regression evidence. It
  is not a public guarantee.
