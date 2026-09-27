# Feature Specification: Second Provider Validation (WebLLM)

**Feature Branch**: `007-second-provider-validation`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Use WebLLM as a second real provider to test whether AkariSP's
internal core contract is overfitted to the Chrome Prompt API resource model, and change only
the mismatches proven by real experiments, before the first npm publish. No speculative
future-proofing, no fake clone, no provider registry / fallback / capability framework."

## Research Evidence (authoritative)

Eleven experiments against WebLLM 0.2.85 (source inspected at the `v0.2.85` tag and at `main`
`bd46399`), model `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`, desktop Chrome 152 on macOS with WebGPU.
Stored in `experiments/webllm/` (harness + `results/`). Summary:

| ID | Observed | Contract implication |
|---|---|---|
| E1 | Independent requests on one engine do not leak context (marker absent in B, C) | Per-task session objects are not needed for isolation |
| E2 | Core fails at the mandatory `clone()` (`TaskError('failed')`, cause `TypeError`) | Mandatory clone is Chrome-specific |
| E3 | Two concurrent streams: B's first chunk after A's end | Provider execution may be serialized regardless of AkariSP's limit |
| E4 | Engine-wide interrupt stopped the running A, not the waiting B; B's iterator `return()` did not prevent B from running | No request-local cancellation for requests waiting inside the provider |
| E5 | After an interrupt, following non-streaming requests returned `""` until a streaming request ran | Non-streaming path is polluted by stale interrupt state |
| E6 | After early `break` of a stream, the next request never started (lock leaked in 0.2.85) | Early termination needs a provider-specific cleanup protocol |
| E6b | Interrupt then drain to the natural end: next request started 42 ms later and completed | A working cleanup protocol exists |
| E7 | `unload()` had to be awaited (68 ms); requests afterwards fail with `ModelNotLoadedError` | Long-lived cleanup is asynchronous |
| E7b | `unload()` during generation broke the active stream | Active work must finish cleanup before shared-resource cleanup |
| E8 | All failures are plain named errors (`ModelNotLoadedError`, `ModelNotFoundError`, `NonNegativeError`, …), none a `DOMException`; interrupt ends with `finish: "abort"`, no error | The core's `InvalidStateError` broken rule is Chrome-specific |
| E9 | Two system prompts alternated on one engine keep per-template output; equal time-to-first-token | Template selection does not require one warm resource per template |

## Clarifications

### Session 2026-09-27

- Q: WebLLM with `limit > 1`? → A: Option A. Rejected at runtime creation with a `TypeError`: one
  engine cannot generate in parallel, and extra tasks must wait in AkariSP's own queue where
  cancellation is task-local (E3, E4).
- Q: Where does the WebLLM integration live? → A: Option A. In production source as an internal
  module (for example `src/webllm/`) that receives an already-created WebLLM engine; no WebLLM
  dependency; not exported from the package root. This is an **internal integration
  implementation until 008**, not a decision that WebLLM is a permanent public provider. Whether
  it becomes public, moves to a separate package, or is rebuilt behind a different extension
  boundary stays open for 008.

## User Scenarios & Testing *(mandatory)*

Actors: **AkariSP maintainers** deciding the contract before first publish; **application
developers** who must see the same run / stream / snapshot / shutdown behavior on either
provider.

### User Story 1 - The core no longer assumes Chrome's resource model (Priority: P1)

The provider-neutral core runs tasks, cancels them, and shuts down without requiring a clone
operation, a synchronous destroy, or Chrome's error vocabulary. Chrome keeps its native
warm-session + clone lifecycle; WebLLM uses its native shared-engine + request lifecycle, with no
fake clone.

**Why this priority**: This is the contract correction the evidence requires before publishing.

**Independent Test**: The core's automated suite runs one lifecycle policy against a fake
Chrome-style provider (base + clone) and a fake request-style provider (shared resource, no
clone); the core source contains no clone requirement and no Chrome error names.

**Acceptance Scenarios**:

1. **Given** a provider with no clone operation, **When** tasks run, **Then** they complete with
   the same run / stream semantics as on Chrome (E2).
2. **Given** the Chrome provider, **When** tasks run, **Then** each task still gets its own
   native clone of the selected warm session, destroyed before the slot is released.
3. **Given** the core source, **When** inspected, **Then** it contains no clone-specific,
   `DOMException`, or `InvalidStateError` rule (E2, E8).

---

### User Story 2 - Shutdown waits for real, ordered provider cleanup (Priority: P1)

`shutdown()` resolves only after queued work is settled, active tasks are stopped and their
provider-side cleanup has completed, and only then the long-lived provider resources are
released and that release has completed.

**Why this priority**: E7/E7b show that resolving early or releasing shared resources first
breaks active work and leaves resources in use.

**Independent Test**: With a provider whose task cleanup and resource release take time,
`shutdown()` resolves only after both completed, in that order, and never releases a shared
resource while a task is active.

**Acceptance Scenarios**:

1. **Given** an active task and a provider with asynchronous cleanup, **When** `shutdown()` is
   called, **Then** it resolves after the task's cleanup completed and after the long-lived
   resource release completed (E7).
2. **Given** an active task, **When** shutdown runs, **Then** no long-lived resource is released
   before that task's cleanup completed (E7b).
3. **Given** Chrome, **When** shutdown runs, **Then** the existing order (task session destroyed,
   then base sessions) is unchanged.

---

### User Story 3 - Cancelling one task never disturbs another (Priority: P1)

A caller abort, timeout, early stream break, or shutdown ends only the targeted task(s); an
unrelated running or queued task is unaffected, and the next task runs normally.

**Why this priority**: E4–E6 show WebLLM can violate this if AkariSP hands it concurrent
requests or ends streams naively.

**Independent Test**: On WebLLM, abort a queued task while another runs; interrupt an active
task; break a stream early; in each case the unrelated task completes normally and a following
task produces normal output.

**Acceptance Scenarios**:

1. **Given** task A running and task B waiting, **When** B is aborted, **Then** A completes
   normally and B never executes (E4).
2. **Given** task A running, **When** A is cancelled (abort, timeout, or early break), **Then** A
   ends with AkariSP's existing outcome and the next task starts and produces normal, non-empty
   output (E5, E6, E6b).
3. **Given** WebLLM, **When** tasks are admitted, **Then** at most one provider request is in
   flight per loaded engine at any time (E3, E4).

---

### User Story 4 - Broken state is decided by the provider (Priority: P2)

Each provider decides which of its failures mean "this resource can no longer serve new work";
the core applies the existing runtime-wide broken semantics (active tasks end by their
lifecycle, queued and future tasks are rejected, no automatic recovery).

**Why this priority**: E8 shows Chrome's rule never fires for WebLLM.

**Independent Test**: A provider-classified "unusable" failure moves the runtime to broken with
the existing semantics; an ordinary failure fails only its task; Chrome's `InvalidStateError`
still means broken.

**Acceptance Scenarios**:

1. **Given** Chrome, **When** a clone fails with its current broken condition, **Then** the
   runtime becomes broken exactly as today.
2. **Given** WebLLM whose engine is no longer loaded, **When** a task starts, **Then** the
   runtime becomes broken (E7, E8).
3. **Given** WebLLM, **When** a request fails with an ordinary error (for example an invalid
   generation setting), **Then** only that task fails (E8).

---

### User Story 5 - Templates keep their meaning on both providers (Priority: P2)

`run(input, { template })` and `stream(input, { template })` select the same configuration on
both providers. Chrome may keep one warm session per template; WebLLM shares one loaded engine
and applies the template to each request.

**Why this priority**: E9 shows templates are request construction on WebLLM, not resources.

**Independent Test**: Alternate two templates on each provider; each task's output reflects only
its own template; on WebLLM exactly one engine is loaded regardless of template count.

**Acceptance Scenarios**:

1. **Given** templates `risk` and `default`, **When** tasks alternate between them, **Then** each
   task sees only its own template's configuration on both providers (E9).
2. **Given** WebLLM with N templates, **When** the runtime is created, **Then** one engine is
   loaded, not N.
3. **Given** an unknown template, **When** a task selects it, **Then** it fails as today, without
   side effects.

---

### User Story 6 - Evidence is preserved and re-validated on real browsers (Priority: P2)

The research harness, results, and the provider validation run stay in the repository, and the
final implementation is validated on real Chrome (Prompt API) and real WebLLM in a browser.

**Why this priority**: Fake providers cannot prove provider behavior; 008 needs the evidence.

**Independent Test**: Each experiment has recorded metadata and a verdict; the real-provider
validation page shows the required checks passing on both providers.

**Acceptance Scenarios**:

1. **Given** `experiments/webllm/`, **When** inspected, **Then** each experiment records the
   WebLLM version and source revision, model, browser/version, WebGPU capability, expected
   result, observed result, verdict, and contract implication.
2. **Given** real Chrome with an available model, **When** the existing lifecycle harness runs,
   **Then** all its lifecycle checks pass.
3. **Given** a WebGPU browser with the WebLLM model cached, **When** the WebLLM validation runs,
   **Then** the 9 required checks pass (see FR-615).

### Edge Cases

- A WebLLM task is cancelled before its request reaches the engine: it never reaches the engine.
- A WebLLM stream is broken early exactly when generation finishes: cleanup still completes once
  and the next task runs.
- An interrupt was issued and no task follows: the next task (whenever it comes) is not polluted.
- WebLLM runtime creation fails (for example `limit > 1` or invalid options): the injected
  engine is left untouched and is not unloaded; ownership never transferred (FR-617).
- A provider's cleanup rejects or throws: shutdown still completes and resolves (existing
  swallow policy), without skipping later cleanup steps.
- Shutdown is called twice or concurrently while provider cleanup is pending: one cleanup, one
  shared completion (existing idempotency).
- WebLLM with `limit > 1`: see FR-613.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-601**: The core MUST NOT require a clone operation; a provider MUST be able to run tasks
  on a long-lived resource without producing per-task session objects (E1, E2).
- **FR-602**: The Chrome provider MUST keep its native lifecycle: per template a warm session,
  per task a native clone, task session destroyed before the slot is released, base sessions
  destroyed at shutdown.
- **FR-603**: The WebLLM integration MUST NOT contain a synthetic or fake clone operation.
- **FR-604**: The core MUST NOT assume the long-lived provider resource and the per-task
  execution unit are the same kind of object.
- **FR-605**: Task cleanup and long-lived resource cleanup MAY be asynchronous; the core MUST
  await their completion (E7).
- **FR-606**: `shutdown()` MUST resolve only after: queued work settled, active tasks stopped,
  every task cleanup completed, then every long-lived resource cleanup completed — in that order;
  no long-lived resource is released while a task is active (E7b).
- **FR-607**: The broken decision MUST be provider-specific; the core MUST NOT reference any
  provider's error vocabulary. Chrome MUST keep today's condition exactly (the clone error is a
  `DOMException` named `InvalidStateError` and the task was not aborted). The broken decision is
  taken when a task starts, as today. WebLLM MUST classify a task start on an engine that is no
  longer loaded as broken (E7, E8) and other failures as ordinary. A resource-fatal failure during
  generation fails that task; 007 does not promote it to broken at that moment, and the runtime
  becomes broken when the next task's start detects the unusable engine. Runtime-wide broken
  semantics are unchanged.
- **FR-608**: Cancelling one task (caller abort, timeout, early stream termination, shutdown)
  MUST NOT stop or alter any other task (E4).
- **FR-609**: For WebLLM, at most one provider request MAY be in flight per loaded engine; tasks
  beyond it wait in AkariSP's own queue, where cancellation is already task-local (E3, E4).
- **FR-610**: After any WebLLM task ends early, the next task MUST start and produce normal
  output: no leaked lock, no stale interrupt state (E5, E6, E6b).
- **FR-611**: `run()` and `stream()` MUST keep their public semantics on both providers. The
  WebLLM integration MAY implement both on its streaming path (E5).
- **FR-612**: The task streaming shape (an async sequence of text chunks) MUST stay unchanged
  unless a proven mismatch requires otherwise; none is currently known.
- **FR-613**: Creating a WebLLM runtime with `limit > 1` MUST be rejected with a `TypeError`
  before any provider work. `limit` 1 (the default) is accepted; `queueCapacity` works as today.
  Snapshot `active` therefore always equals the number of requests actually in flight.
- **FR-614**: Templates MUST keep their observable selection semantics on both providers; the
  core MUST NOT assume one long-lived provider resource per template; WebLLM MUST load one engine
  and apply the selected template's configuration to each request (E9).
- **FR-615**: A real-browser WebLLM validation MUST pass: (1) context isolation on a shared
  engine, (2) task execution without clone, (3) same-engine serialization, (4) queued-task
  cancellation, (5) next task normal after active cancellation, (6) resources released after early
  stream termination, (7) shutdown waits for async unload, (8) broken vs non-broken
  classification, (9) template semantic isolation.
- **FR-616**: All 001–006 behavior on Chrome MUST remain: existing automated tests pass (their
  harness MAY be adapted to the new contract; no assertion may be weakened), and the real Chrome
  lifecycle harness passes.
- **FR-617**: The WebLLM integration MUST live in production source as an internal module that
  receives an already-created WebLLM engine, adds no WebLLM dependency, and is not exported from
  the package root. It is an internal integration implementation until 008; 007 does not decide
  that WebLLM is a permanent public provider, a separate package, or the final extension
  boundary. Those remain open for 008.
- **FR-618**: The research evidence (`experiments/webllm/`, results, and a per-experiment table
  with the metadata in User Story 6) MUST be kept in the repository, separate from production
  source.
- **FR-619**: Any public API change MUST cite the experiment that requires it. Public API changes
  are not a goal.
- **FR-620**: The feature MUST NOT add a provider registry, automatic detection, fallback,
  priority, capability matrix, scheduler framework, automatic model download, package split,
  public provider packages, framework integrations, telemetry, hot swap, or automatic recovery;
  no core → browser and no core → WebLLM dependency; runtime dependencies stay 0.

### Key Entities

- **Provider**: (internal until 008) creates the long-lived resource(s) for the runtime's configurations, executes
  tasks on them, decides "broken", and releases resources.
- **Long-lived resource**: Chrome — one warm session per template; WebLLM — one loaded engine.
- **Task execution**: Chrome — a cloned session used for one task; WebLLM — one generation
  request built from the template configuration and the task input.
- **Experiment record**: version, revision, model, browser, WebGPU, expected, observed, verdict,
  implication.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-601**: 0 clone requirements and 0 Chrome error names in the core; 0 fake clones in the
  WebLLM integration.
- **SC-602**: 100% of existing 001–006 behavior tests pass with no weakened assertion; real Chrome
  lifecycle harness passes all checks.
- **SC-603**: All 9 real-WebLLM validation checks pass in a real browser.
- **SC-604**: In 100% of shutdown tests, shutdown resolves only after task cleanup and long-lived
  resource cleanup completed, in that order.
- **SC-605**: After each of the 3 in-runtime early-end causes (caller abort, timeout, early
  stream break), the next WebLLM task produces non-empty output.
- **SC-606**: Aborting a waiting task leaves the running task's output complete in 100% of runs.
- **SC-607**: Every experiment record contains all 9 metadata fields.
- **SC-608**: Every public API change (if any) links to at least one experiment; runtime
  dependencies stay 0.

## Assumptions

- Target WebLLM version is 0.2.85 (the current npm release). The interrupt + drain protocol (E6b)
  is used because 0.2.85 leaks its lock on early `return()`; `main` fixes this but is unreleased.
- WebLLM engines are created by the application (model choice and download are the application's
  business); AkariSP never starts a model download.
- WebLLM "broken" is recognized at task start from the error names `ModelNotLoadedError`
  (observed) and `DeviceLostError` (not observed); other WebLLM errors are ordinary failures. The
  list grows only with evidence.
- WebLLM engine ownership (internal until 008): the application creates the engine; once runtime
  creation succeeds, the runtime uses it exclusively (the caller must not run its own generations
  on it) and unloads it at shutdown; if runtime creation fails, the engine is not unloaded.
- The engine is a provider-wide resource, distinct from per-template resources: templates never
  own or release it.
- An interrupted WebLLM generation ends without an error; AkariSP's outcome for it comes from its
  own cancellation signal, as today.
- Chrome's existing lifecycle, error mapping, and public behavior are the regression reference.
- Existing automated tests may need harness changes to the new internal contract; assertions stay.
- Mobile and non-WebGPU browsers are out of scope for the WebLLM validation.
