# Feature Specification: Core / Browser Provider Boundary

**Feature Branch**: `005-core-provider-boundary`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Add a provider boundary to AkariSP and separate the
provider-neutral runtime core (`@akarisp/core`) from the browser-native AI integration
(`@akarisp/browser`, currently backed by the Chrome Prompt API). Core owns policy (admission,
queue, concurrency, templates, run/stream lifecycle, cleanup, broken state, shutdown, snapshot,
TaskError, TaskTiming); browser owns mechanism (access to the native API, create / clone /
prompt / stream / destroy). All 001–004 semantics unchanged. No `@akarisp/chrome` package, no
second provider, no universal provider framework."

## Clarifications

### Session 2026-09-27

- Q: Package boundary — separate publishable packages now (A) or an enforced source-level
  boundary in the existing single distribution (B)? → A: B. Separate core and browser source
  areas with an automated boundary check; the npm package stays single for now.
- Q: Core creation API shape — `createRuntime(provider, options)` or
  `createRuntime({ provider, ... })`? → A: Provider as the first argument, internally.
- Q: Provider/session contract visibility — public now or internal until 006? → A: Internal in
  005; public extension API decided in 006 after a second provider validates it.
- The user-facing `createRuntime(options)` stays in the browser entry point and keeps the
  001–004 import path and behavior exactly.

## User Scenarios & Testing *(mandatory)*

Two users are affected:
- **Application developers** building with browser-native AI, who must keep a simple entry point
  and identical behavior.
- **AkariSP maintainers**, who need the runtime policy separated from the browser mechanism so
  it can be tested with a fake provider now and reused by a second provider later (feature 006).

### User Story 1 - Browser users keep the same experience (Priority: P1)

A developer using AkariSP in a supported browser creates a runtime with the same options as
before (none, a default session, and/or templates) and uses run, stream, snapshot, and shutdown
exactly as before. They do not need to know a provider exists.

**Why this priority**: The extraction must be invisible to ordinary users (Principle XII).

**Independent Test**: Every 001–004 behavior test passes through the browser-facing entry point,
and the real-browser smoke test passes 5/5.

**Acceptance Scenarios**:

1. **Given** a supported browser, **When** a developer creates a runtime through the browser
   entry point with any 001–004 option combination, **Then** creation, templates, run, stream,
   cancellation, timeout, broken state, snapshot, and shutdown behave exactly as before.
2. **Given** the browser entry point, **When** a runtime is created, **Then** no provider object
   or extra argument is required, and the import path and public exports are the same as in
   001–004.
3. **Given** the real-browser smoke test, **When** it runs against the new browser entry point,
   **Then** all five scenarios pass.

---

### User Story 2 - Core is provider-neutral (Priority: P1)

The core runtime contains no reference to browser-native AI globals or browser availability
APIs. It can be loaded in an environment without them (for example a plain server-side
JavaScript runtime) without errors or side effects, and all runtime policy is exercised through a
small provider contract that a test can implement with a simple fake.

**Why this priority**: This is the architectural goal and the precondition for feature 006.

**Independent Test**: Load the core in an environment with no browser AI global; nothing throws,
nothing is created, and no browser detection runs. Run the full lifecycle suite against a fake
provider passed to the core.

**Acceptance Scenarios**:

1. **Given** an environment without any browser AI global, **When** the core is loaded, **Then**
   no error is thrown, no session is created, and no global is read.
2. **Given** a fake provider implementing only the minimal contract, **When** the core runtime is
   created with it, **Then** every 001–004 lifecycle rule (templates, sequential creation and
   rollback, shared queue and limit, FIFO, lazy streams, cancellation, timeout, early break,
   paused-consumer cleanup, broken state, shutdown, snapshot, errors, timing) holds.
3. **Given** the core source, **When** it is inspected, **Then** it contains no reference to the
   browser AI global, the browser window object, or browser availability APIs.

---

### User Story 3 - Browser integration is a thin mechanism (Priority: P2)

The browser integration only maps the core's provider operation (create) onto the
browser-native API and hands the resulting native sessions to the core unwrapped; native sessions
already satisfy the core's session contract (clone, prompt, streaming prompt, destroy), so no
session wrapper exists. It contains no queueing, lifecycle, template, or cleanup policy.

**Why this priority**: Keeps policy in one place; prevents a second, drifting scheduler.

**Independent Test**: Adapter tests verify that create delegates to the native API with the same
configuration object, that the native session is used by the core as returned, that the native
global is read only when a base session is actually created, and that the public entry point
connects the browser provider to the core; no scheduler or session-operation behavior is tested
there.

**Acceptance Scenarios**:

1. **Given** the browser integration, **When** the core asks it to create a session, **Then** it
   calls the native create operation with the same configuration object and returns the native
   session itself, which the core then clones, prompts, streams, and destroys directly.
2. **Given** the browser entry point is loaded where the native global is absent, **When** it is
   imported, **Then** nothing throws and the global is not read; it is read only when a base
   session is created.
3. **Given** a native error, **When** it occurs, **Then** it reaches the core unchanged so the
   core's existing error rules (cancelled / failed / broken) apply.

---

### Edge Cases

- Browser entry point used where the browser AI global is absent: creating a runtime fails with
  the same underlying error as before the extraction (the native create call is absent); loading
  the entry point itself does not throw.
- A native clone failure that is a standard `DOMException` named `InvalidStateError` still moves
  the runtime to broken; the core keeps the existing check exactly and references no
  browser-AI-specific error type.
- A provider's destroy throws: the existing swallow policy applies in core.
- Template names never reach the provider; it only receives configuration and session operations.
- Snapshot never includes provider or browser information.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-401**: The runtime MUST be split into a provider-neutral core and a browser-native
  integration, with dependencies only from the browser integration to the core.
- **FR-402**: The core MUST own all policy from 001–004: runtime state, admission, bounded queue,
  concurrency slots, FIFO, template selection, base-session creation order and rollback,
  clone-per-task lifecycle, cancellation and timeout, streaming lifecycle, cleanup ordering,
  runtime-wide broken state, shutdown ordering, snapshot, task errors, and task timing.
- **FR-403**: The core MUST obtain sessions only through a minimal provider contract derived from
  operations it already performs: create a session from configuration; and on a session, clone,
  prompt, streaming prompt, and destroy, with the cancellation signal passed through. No other
  operation (embeddings, tools, token counting, model listing, capabilities, health, metadata,
  download management) is added.
- **FR-404**: The core MUST NOT reference the browser AI global, the browser window object,
  browser-specific AI type declarations, or browser availability APIs, and loading it MUST have
  no side effects.
- **FR-405**: The browser integration MUST own all access to the browser-native AI API and
  implement the provider contract as a thin mapping with no scheduling, lifecycle, template, or
  cleanup policy.
- **FR-406**: The browser integration MUST offer a runtime creation entry point accepting the
  same options as 001–004 (no options, default session, templates, limit, queue capacity) with no
  provider argument, producing identical behavior.
- **FR-407**: All 001–004 behavior MUST remain unchanged, including error codes and causes, the
  clone → broken rule (a `DOMException` named `InvalidStateError`, checked exactly as today), timing fields, snapshot fields,
  sequential template creation with rollback, and lazy streams.
- **FR-408**: No package or public entry point named after a specific browser vendor MUST be
  introduced; the vendor-specific adapter is internal to the browser integration.
- **FR-409**: The boundary MUST be an enforceable source-level boundary inside the existing
  single distribution: core and browser integration live in separate source areas, and an
  automated check fails if the core references the browser AI global or imports anything from
  the browser integration. No new publishable package is created in this feature; splitting into
  separate packages is deferred until publishing or feature 006 needs it.
- **FR-410**: Provider-neutral runtime creation in the core MUST take the provider as a separate
  first argument, followed by the unchanged runtime options (`createRuntime(provider, options)`).
  The browser entry point MUST be the existing user-facing `createRuntime(options)`, which
  internally injects the browser provider into the core.
- **FR-411**: The provider/session contract and the core's provider-taking creation function MUST
  remain internal in this feature: not exported from the public entry point and not documented as
  an extension API. Only the browser integration and tests use them. Whether to make them public
  is decided in feature 006 after a second provider validates the abstraction.
- **FR-412**: Lifecycle policy tests (including clone, prompt, streaming prompt, signal
  propagation, destroy, cancellation, streaming lifecycle, templates, broken, and shutdown) MUST
  run against the core with a fake provider. Browser integration tests MUST only verify what the
  browser integration owns: create delegation with the same configuration object, native sessions
  usable by the core as returned, lazy global access, safe import without the global, and the
  public entry point wiring the browser provider to the core. No session wrapper may be added to
  make browser tests possible.
- **FR-413**: The real-browser smoke test MUST exercise browser integration → core.
- **FR-414**: The feature MUST NOT add runtime dependencies, a second provider, provider
  auto-selection, fallback chains, capability negotiation, health state, recovery, retries,
  plugin or dependency-injection frameworks, framework adapters, or provider-specific scheduling
  or templates.

### Key Entities

- **Provider**: Creates a session from configuration. The only thing the core needs from the
  outside world.
- **Session (provider-side)**: Supports clone, prompt, streaming prompt, and destroy; honors a
  cancellation signal.
- **Core Runtime**: Everything from 001–004, parameterized by a provider.
- **Browser Integration**: The browser-native provider plus the zero-argument browser entry point.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-401**: The core contains 0 references to the browser AI global, browser window object, or
  browser availability APIs.
- **SC-402**: Loading the core in an environment without the browser AI global produces 0 errors
  and 0 session creations.
- **SC-403**: 100% of 001–004 behavior tests pass, with lifecycle policy exercised through the
  core and a fake provider.
- **SC-404**: Browser integration tests cover create delegation, configuration identity, native
  session pass-through, lazy global access, import without the global, and public entry wiring,
  and contain no scheduling, lifecycle, or session-operation assertions.
- **SC-405**: The real-browser smoke test passes 5/5 through the browser entry point.
- **SC-406**: A complete fake provider for tests fits in a small amount of test code (no more than
  the current test fake), demonstrating the contract is minimal.
- **SC-407**: Runtime dependency count stays 0; no vendor-named public package or entry point
  exists; the public exports are identical to 004 (no provider or session contract exported).

## Assumptions

- Builds on features 001–004; none of their behavior changes.
- The broken condition keeps today's exact check: the clone error is a `DOMException` and its name
  is `InvalidStateError` (and the task was not aborted). `DOMException` is a web-platform standard
  type, not a dependency on the browser AI API, so the check stays in the core unchanged. It is
  not generalized to a name-only check; feature 006 revisits it only if a second provider shows a
  real need. No new error abstraction is added.
- The session contract keeps today's synchronous destroy, because the core's cleanup ordering
  relies on it; an asynchronous destroy is out of scope.
- The shutdown cancellation reason remains a standard abort-type error; this is a standard web
  platform primitive, not a browser AI dependency.
- Configuration values (default session and templates) are passed through to the provider
  unchanged; the core does not interpret them.
- No performance claim is made; no benchmark change (Constitution III). The existing benchmark
  page keeps working through the browser entry point.
