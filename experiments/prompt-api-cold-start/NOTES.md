# Prompt API cold start: pre-feature research (closed)

Candidate: `prompt-api-cold-start-lifecycle-validation`. Researched 2026-09-27 against the
published `akarisp@0.1.0-alpha.2`.

**Decision: DO NOT START FEATURE — EXISTING BEHAVIOR IS SUFFICIENT.** No spec was created, and
feature number 012 stays free.

## Findings

Each finding is tagged with the kind of evidence behind it.

- **Config passthrough** (STATIC_CODE_ANALYSIS, STAND_IN): `session` and template configs reach
  `LanguageModel.create()` unchanged, as the same object with every key kept. The existing test
  "create receives the session and template config objects unchanged" asserts this. The core
  never inspects these fields.
- **`monitor`** (STAND_IN): the native `monitor` option passes through, and AkariSP never calls it.
  Applications can observe native progress directly.
- **Creation-time `signal`** (STAND_IN): aborting a native `signal` while creation is pending makes
  `createRuntime()` reject promptly with the provider's `AbortError`.
  - It is not a `TaskError`.
  - AkariSP owns 0 resources at that point: no base exists before `create()` resolves.
- **`signal` after creation** (STAND_IN of PLATFORM_DOCUMENTATION): aborting the same signal after
  creation destroys the native base. The next task fails with `broken`, whose cause is
  `InvalidStateError`, following the existing broken-provider contract. `shutdown()` still
  resolves. The README documents this lifetime.
- **Real Chrome** (REAL_BROWSER): Chrome 153 with a fresh temporary profile reported
  `availability() === 'unavailable'`. `create()` was never called, so no download was started.
- **Blocked states** (BLOCKED): a real `downloadable` state, a real `downloading` state, and a
  user-activation comparison in those states. None could be reproduced safely.
  - Playwright pages report `navigator.userActivation.isActive === true` even before any click.
- **Available state** (HISTORICAL_EXISTING_EVIDENCE): the lifecycle in the `available` state is
  covered by 008 (Chrome 7/7) and by the 010 manual runs with the real model.
- **Platform documentation** (PLATFORM_DOCUMENTATION, not observed here):
  - States are `unavailable`, `downloadable`, `downloading`, and `available`.
  - `create()` waits for a required download, reports progress to `monitor` as `downloadprogress`
    events, and rejects with `NetworkError` if the download fails.
  - Creation needs user activation.
  - Sources: Chrome "Prompt API" (updated 2026-08-26) and "Get started" (updated 2025-05-20), and
    the webmachinelearning/prompt-api explainer.

## Consequences

- No AkariSP availability, prepare, download, or progress API is justified.
- A dedicated `createRuntime()` cancellation API is not justified by current evidence. The native
  `signal` already passes through, and the 010 late-shutdown pattern still applies to runtimes
  that resolve after their owner is gone.

## Deferred observation

**User-activation continuity across multiple templates.**
- The first `LanguageModel.create()` runs before the first `await`.
- Later templates are created after earlier awaits.
- Whether user activation is still valid for those later creates is unverified.

Revisit only if a real download-required environment can be reproduced, or if a consumer reports
a multi-template creation failure related to user activation.

## Files

| File | Evidence | What it records |
|---|---|---|
| `standin.mjs` → `standin-results-2026-09-27.json` | STAND_IN | Passthrough, abort during creation, abort after creation |
| `availability.mjs` → `availability-results-2026-09-27.json` | REAL_BROWSER | A fresh temporary profile running `availability()` only. The profile is deleted afterwards |
