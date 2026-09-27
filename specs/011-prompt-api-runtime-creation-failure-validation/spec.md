# Feature Specification: Prompt API Runtime Creation Failure Validation

**Feature Branch**: `011-prompt-api-runtime-creation-failure-validation`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Validate that Prompt API runtime creation failures remain
predictable, intentional, provider-boundary failures across the API-absent, provider-unavailable,
and supported conditions, and determine whether the current behavior requires any AkariSP product
change. Contract validation, regression protection, and a consumer documentation boundary; not an
error-abstraction or capability-detection feature. A result with 0 production, 0 public API, and
0 runtime dependency changes is a valid success."

## Evidence (state at the start of 011)

### Pre-feature research

Four experiments were run on 2026-09-27 against the published `akarisp@0.1.0-alpha.2`, whose
production source is identical to `0.1.0-alpha.1` for this behavior.

- **Environments**: Node 23.9 and Playwright Chromium 153. That Chromium exposes no Prompt API, so
  the API-absent state is natural there.
- **Stand-ins**: the unavailable and available states used minimal test-only stand-ins.
- **Location**: two pre-feature research artifacts exist under `experiments/prompt-api-creation/`.
  The 011 plan retains both as reproducible evidence.

| # | Condition | Observed |
|---|---|---|
| 1 | Importing both public entry points with no Prompt API global (Node and browser) | Succeeds. 0 reads of the Prompt API global, 0 runtimes or resources created |
| 2 | Prompt API global absent; the public runtime factory is called | Returns a promise, with no synchronous throw. The promise rejects with `ReferenceError: LanguageModel is not defined`. The failure happens at the first base creation inside the Prompt API integration, and the stack reaches the caller's call. Nothing was created, so nothing needs cleanup |
| 3 | Global present; the stand-in reports availability "unavailable" and rejects creation (`DOMException` `NotSupportedError`) | AkariSP does **not** query availability; it calls creation directly. The promise rejects with the **stand-in's own error, unchanged**. Nothing was created. The error name came from the stand-in; it was **not** verified against a real browser in an unavailable state |
| 4 | Global present and available (stand-in) | The runtime is created. One task runs; its task resource is destroyed, then the base is destroyed, and the runtime ends `closed` |

Real-browser evidence for the supported path already exists:
- Chrome lifecycle checks 7/7 (006, re-run after 007 and 008);
- run and stream with the real model in the 010 manual runs.

### Established design (the behavior above is intended, not accidental)

- **001**: when base session creation fails (model unavailable, still downloading, unsupported
  browser), "initialization fails with the underlying error and no runtime is usable".
- **004**: when one template's base creation fails, creation fails with that error, and the bases
  already created are destroyed.
- **005**: the missing-global `ReferenceError` was explicitly kept as current behavior. The global
  is read lazily, so option errors come first and every creation failure is a promise rejection.
  The browser tests assert this.
- **`TaskError`** is scoped to task outcomes: admission, execution, cancellation, broken, closed.
  - Its timing fields describe task phases (queue wait, acquire, prompt).
  - It is never produced by runtime creation.
  - Pre-feature research finding: applicability to runtime creation is **NO**.
- **The README** documents the missing-global error for server-side creation (010). It does not
  state that AkariSP never queries availability before creating, or that provider creation
  errors are passed through unchanged.

## Clarifications

### Session 2026-09-27

- Q: Does provider-error propagation require that the same JavaScript error object is preserved?
  → A: No. The contract is that provider creation failures are propagated without
  AkariSP-specific translation or wrapping, and without `TaskError` conversion.
  - The repository documents "the underlying error" (001) and "reaches the core unchanged"
    (005), but nowhere guarantees object identity to consumers.
  - Existing core tests already check identity (`test/runtime.test.ts:217`, `:1582`, `:1591`).
    They and any 011 evidence may keep doing so as regression evidence of the current
    implementation, but identity is not a public behavioral guarantee.
- Q: What production changes are allowed if 011 finds contradictory evidence? → A: Two cases.
  - **Allowed**: internal, test, evidence, or documentation changes, where they are needed to
    preserve or verify the **existing** runtime-creation contract.
  - **Not absorbed into 011**: any evidence for changing the contract itself. That covers the
    missing-global `ReferenceError`, provider-error passthrough, `TaskError` scope, public error
    types, and capability or environment APIs. Such evidence is recorded as a separately scoped
    future feature.
  - **Never in scope**: public API additions, new public error classes, runtime dependency
    additions, and capability abstractions.
  - **Expected**: a production source diff of 0 remains a valid and expected outcome.

## User Scenarios & Testing *(mandatory)*

Actors: **application developers** who import AkariSP in environments that may lack the Prompt
API (servers, server-side rendering, browsers without the API), and who call the Prompt API
runtime factory.

### User Story 1 - Safe package consumption (Priority: P1)

A developer imports AkariSP in an environment where the Prompt API does not exist, for example a
server-rendering pass or an unsupported browser. The import succeeds and creates nothing.

**Why this priority**: 010 showed that application code is routinely evaluated on servers.
Import-time safety is what lets frameworks bundle and prerender AkariSP at all.

**Independent Test**: With no Prompt API global present, import each public entry point. Observe
that the import succeeds, the Prompt API global is never read, and no runtime or resource
exists.

**Acceptance Scenarios**:

1. **Given** no Prompt API global, **When** either public entry point is imported in a
   server-like environment or a browser, **Then** the import succeeds.
2. **Given** a Prompt API global whose reads are observed, **When** the package is imported,
   **Then** the global is read 0 times, and no provider operation (creation or availability
   query) is performed.

---

### User Story 2 - Predictable runtime creation failure (Priority: P1)

A developer calls the Prompt API runtime factory where the Prompt API is absent, or where it is
present but refuses to create a session. The developer gets the actual environment or provider
failure through the asynchronous creation result, not a task error and not a synchronous throw.
No resources are left behind.

**Why this priority**: this is the question 011 exists to answer. The behavior is intended (001,
004, 005), so it must stay observable and protected, not silently drift.

**Independent Test**: For each failure condition, call the factory and observe the following:
- whether it throws synchronously or rejects;
- the rejection's error;
- whether the error is a task error;
- how many provider resources remain afterwards.

**Acceptance Scenarios**:

1. **Given** no Prompt API global, **When** the factory is called with valid options, **Then** it
   returns a promise. The promise rejects with the environment's missing-global error, currently
   `ReferenceError` with the message `LanguageModel is not defined`. No resource is created.
2. **Given** no Prompt API global, **When** the factory is called with invalid AkariSP options,
   **Then** it rejects with the existing configuration error, and the Prompt API global is never
   read.
3. **Given** a Prompt API global whose session creation rejects, **When** the factory is called,
   **Then** the promise rejects with the provider's error, not translated, wrapped, or turned into
   a task error, and no resource remains.
4. **Given** several templates whose second base creation rejects, **When** the factory is
   called, **Then** it rejects with that creation error, and every base already created is
   destroyed exactly once.
5. **Given** any runtime creation failure above, **When** the error is inspected, **Then** it is
   not a task error.

---

### User Story 3 - Supported runtime lifecycle remains unchanged (Priority: P2)

A developer whose Prompt API is available creates a runtime, runs a task, and shuts the runtime
down, exactly as before this feature.

**Why this priority**: this is the control. Any work on the failure paths must leave the
supported path untouched.

**Independent Test**: With an available Prompt API, create a runtime, run one task, and shut it
down. Observe success, the cleanup order, and the final state.

**Acceptance Scenarios**:

1. **Given** an available Prompt API, **When** a runtime is created, one task is run, and the
   runtime is shut down, **Then** creation and the task succeed. The task resource is destroyed
   before the base, and the runtime ends `closed`.

---

### Edge Cases

- **Prompt API global absent** (server-side rendering, Node, or an unsupported browser): see User
  Story 2, scenario 1.
- **Invalid options while the global is absent**: the configuration error wins, and the global is
  never read (User Story 2, scenario 2).
- **Global present, creation rejects**: the provider error passes through unchanged (User Story 2,
  scenario 3). What a real browser rejects with while unavailable is not asserted here.
- **Partial multi-template creation**: a later creation fails, and the earlier bases are destroyed
  (004; User Story 2, scenario 4).
- **Supported creation**: User Story 3.
- **Import during server-side rendering or prerendering**: User Story 1 (also observed in 010).

## Requirements *(mandatory)*

### Functional Requirements

**Import boundary**

- **FR-1101**: Importing any public entry point MUST NOT read the Prompt API global, create any
  runtime or provider resource, or perform any provider capability or availability check. This
  holds in environments with and without the Prompt API.

**Validation ordering**

- **FR-1102**: Invalid AkariSP options MUST fail with the existing configuration error before, and
  without, any Prompt API global read. The current failure order (configuration first, then
  provider creation) MUST be preserved.

**Creation failure contract**

- **FR-1103**: The Prompt API runtime factory MUST report every creation failure asynchronously,
  through its returned promise, and never by a synchronous throw.
- **FR-1104**: When the Prompt API global is absent, runtime creation MUST fail with the
  environment's missing-global error, currently `ReferenceError` / `LanguageModel is not defined`.
  This is the established contract (001, 005) and is covered by existing tests. 011 MUST NOT
  change it. Evidence that it should change is recorded as a separately scoped future feature
  (see FR-1112).
- **FR-1105**: When Prompt API session creation rejects, runtime creation MUST reject with the
  provider's error, without AkariSP-specific translation or wrapping (001: "the underlying
  error"). AkariSP MUST NOT reinterpret or replace it, unless a documented AkariSP contract
  requires translation; no such contract exists today.
  - Preserving the same error object is the current implementation, and tests may check it as
    regression evidence.
  - It is not a public guarantee of this requirement.
- **FR-1106**: A failed runtime creation MUST leave no provider resource behind. Every base
  created before the failure is destroyed exactly once (004), and none remain when nothing was
  created.
- **FR-1107**: Runtime creation failures MUST NOT be represented as `TaskError`, and the public
  meaning of `TaskError` MUST NOT be widened to cover runtime creation or provider availability.

**Supported path**

- **FR-1108**: With an available Prompt API, the supported lifecycle MUST keep working, with
  cleanup and final state unchanged:
  - create the runtime;
  - run one task;
  - clean up the task, then the base;
  - shut down to `closed`.

**Evidence and regression protection**

- **FR-1109**: Each behavior in FR-1101 to FR-1108 MUST be covered by reproducible evidence that
  exercises the public path. Behavior already covered by the repository's existing tests counts;
  gaps are covered by adding evidence. How the evidence is organized, and what happens to the
  current research files, is a planning decision.
- **FR-1110**: The evidence MUST distinguish what was observed on real browsers from what was
  observed with stand-ins. It MUST NOT claim a specific real-browser error for the unavailable
  state that was not observed.

**Documentation**

- **FR-1111**: The public documentation MUST describe the observed creation-failure behavior in a
  few sentences:
  - the factory rejects asynchronously;
  - the missing-global error is what applications see without the Prompt API;
  - provider creation errors are passed through unchanged;
  - AkariSP does not query availability before creating;
  - applications that need a preflight check can use the platform's own Prompt API checks, **in
    this order**: first test whether the Prompt API global exists, and only when it is present,
    query its availability.

  It MUST NOT present any AkariSP capability, availability, or environment API.

**Scope**

- **FR-1112**: A production source diff of 0 is a valid and expected outcome, along with 0 public
  API changes and 0 runtime dependency changes.
  - **Allowed**: internal, test, evidence, or documentation changes, only where they are needed to
    preserve or verify the **existing** runtime-creation contract (FR-1101 to FR-1108).
  - **Not absorbed into 011**: evidence for changing the contract itself. That covers the
    missing-global error, provider-error passthrough, `TaskError` scope, public error types, and
    capability or environment APIs. It is recorded as a separately scoped future feature.
  - **Never in scope**: public API additions, new public error classes, runtime dependency
    additions, and capability abstractions.

### Key Entities

- **Creation failure record**: per condition, captures:
  - the condition (absent, provider rejection, partial multi-template, invalid options);
  - how the failure was reported (synchronous throw or rejection);
  - the error's type, name, and message;
  - whether it was passed through without translation (object identity may be noted as
    regression evidence);
  - whether it is a task error;
  - the provider resources left over;
  - the evidence source (real browser or stand-in).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-1101**: Package import succeeds with 0 Prompt API global reads and 0 resources in 100% of
  the tested environments without the Prompt API: a server-like environment and a browser.
- **SC-1102**: The missing-global creation failure is reproducibly covered. It shows a rejection
  (0 synchronous throws), the missing-global error, and 0 resources created.
- **SC-1103**: The provider-rejection creation failure is reproducibly covered. It shows:
  - the provider's error propagated with 0 AkariSP translations or wrappers;
  - 0 task errors;
  - 0 resources left, including the partial multi-template case, where every earlier base is
    destroyed exactly once.

  Checking the error object's identity is allowed as regression evidence, but it is not a
  required outcome.
- **SC-1104**: Invalid configuration continues to fail with 0 Prompt API global reads.
- **SC-1105**: The supported lifecycle succeeds, with the task resource destroyed before the base
  and the final state `closed`.
- **SC-1106**: 0 new public API names, 0 new public error types, and 0 new runtime dependencies
  are added. Any evidence for a contract change is recorded as a separately scoped future
  feature, not implemented in 011.
- **SC-1107**: Every creation-failure statement in the public documentation matches an observed
  result, and none describes behavior that was not observed.

## Assumptions

- **Test environments**: server-like environments and Chromium without the Prompt API are
  adequate for the absent state. Stand-ins are adequate to show pass-through for the rejecting
  and available states. Real-browser confirmation of a specific unavailable-state error is not
  required.
- **Existing coverage**: the repository's current tests (missing-global rejection, 0 reads on
  import and on invalid options, multi-template creation cleanup) count as evidence for the
  behaviors they already assert.
- **Consumer preflight**: applications that need to decide before creating a runtime use the
  platform's own Prompt API checks. No evidence shows that AkariSP must offer a machine-readable
  classification.
- **Deferred observation, not a requirement**: AkariSP creates sessions without first querying
  availability. Prompt API notes in the 006 compatibility harness indicate that creation can
  start a model download in some states (downloadable or downloading). Whether calling the
  factory causes observable download side effects was **not** validated, and it is outside 011.
  Download progress, cancellation, installation, and availability orchestration are also out of
  scope.
- **Non-goals, unchanged from the input**:
  - no support or capability queries on the runtime, and no public capability, environment, or
    availability API;
  - no new error types (unsupported environment, capability, provider unavailable, browser
    support);
  - no provider registry, discovery, routing, or fallback (including Chrome → WebLLM);
  - no automatic downloading or download manager, and no third provider;
  - no framework adapters, package split, or monorepo;
  - no plugin, telemetry, agent, workflow, or RAG systems.

  Decisions closed by 010 are not reopened.
