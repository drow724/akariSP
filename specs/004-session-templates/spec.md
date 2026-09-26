# Feature Specification: Named Session Templates

**Feature Branch**: `004-session-templates`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Add named session template support to AkariSP: one runtime owns
a small fixed set of named warm base sessions with different initial context; each task
selects exactly one template and clones that template's base; all templates share the
existing limit, queue, cancellation, lazy streaming, broken, shutdown, and snapshot
semantics. Not a cache, router, agent framework, or provider abstraction."

## Clarifications

### Session 2026-09-27

- Q: template로 무엇을 넘기나요? → A: Session configuration (same kind as the existing `session`
  option); the runtime creates and owns each base itself.
- Q: broken은 runtime 전체인가요, template별인가요? → A: Runtime-wide. Any template's untrusted
  base moves the whole runtime to broken; waiting and later tasks on every template are
  refused; already-running tasks on any template finish; snapshot reports broken.
- Q: task에서 template을 어떻게 지정하고, 기존 호출은 어떻게 유지하나요? → A: As an option
  (`run(input, { signal, template })`, same for `stream`). The existing single-session
  configuration is the unnamed default template; omitting `template` uses it. Session and
  templates may be combined. When templates are configured without a session, there is no
  default: omitting `template` fails with an argument error (`TypeError`) before admission
  (`run`) or at the first pull before admission (`stream`), and never picks a template
  automatically.

## User Scenarios & Testing *(mandatory)*

The primary user is an **application developer** who runs several kinds of tasks that each
need a different fixed starting context (e.g. "momentum", "risk", "summary" analyses) and
wants one runtime, one concurrency budget, and one shutdown instead of managing several
runtimes by hand.

### User Story 1 - Run tasks against a chosen template (Priority: P1)

A developer creates a runtime with a fixed set of named templates, each defined by its own
session configuration and initial context. Each task names the template it needs; the task
runs in a fresh clone of that template's warm base session and sees only that template's
context.

**Why this priority**: This is the feature's entire user value.

**Independent Test**: Create a runtime with templates "momentum" (initial context
"momentum system") and "risk" ("risk system"); run one task against each; each task's
session history starts with only its own template's context, and neither base is changed.

**Acceptance Scenarios**:

1. **Given** a runtime with templates A and B, **When** a task selects A, **Then** it runs in
   a clone of A's base and its context contains only A's initial context plus its own input.
2. **Given** tasks on A and B, **When** both finish, **Then** neither template's base context
   was changed and no task saw the other template's context.
3. **Given** a streaming task that selects B, **When** it is consumed, **Then** it streams
   from a clone of B's base with the same lifecycle as existing streaming tasks.

---

### User Story 2 - Templates share one scheduler (Priority: P1)

All templates in a runtime compete for the same concurrency limit and wait in the same
first-come-first-served queue, exactly as tasks do today. Template identity never changes
admission order, and the runtime snapshot stays runtime-wide.

**Why this priority**: Separate budgets would silently multiply device load and violate the
existing backpressure contract (Constitution Principle XI).

**Independent Test**: With limit 2, start a momentum and a risk task (held) and submit a
summary task; the summary task waits; the snapshot reports 2 active and 1 queued; the
summary task starts only when one of the others releases its slot.

**Acceptance Scenarios**:

1. **Given** limit 2 and two held tasks on different templates, **When** a third task on a
   third template is submitted, **Then** it waits in the shared queue and the snapshot shows
   2 active, 1 queued.
2. **Given** tasks admitted in the order risk, momentum, summary, **When** slots free up,
   **Then** they start in that order regardless of template.
3. **Given** a stream created for a template but never consumed, **When** a snapshot is
   taken, **Then** active and queued are unchanged and no clone was made.

---

### User Story 3 - Invalid template selection fails without side effects (Priority: P2)

If a task names a template the runtime does not have, it fails immediately with a clear
error and consumes nothing: no queue entry, no slot, no clone, no state change.

**Why this priority**: A typo must not degrade a shared runtime.

**Independent Test**: Submit a task for "nonexistent" while other tasks run; it fails with a
distinguishable error, the snapshot is unchanged, and no clone happened.

**Acceptance Scenarios**:

1. **Given** a runtime without template X, **When** a task selects X, **Then** it fails with an
   error identifying an unknown template, and the snapshot and clone count are unchanged.
2. **Given** a stream for unknown template X, **When** it is created, **Then** nothing happens;
   **When** it is first consumed, **Then** it fails the same way without admission.

---

### User Story 4 - Existing single-session usage keeps working (Priority: P2)

A developer who configured one session and never names a template keeps using the runtime
exactly as before.

**Why this priority**: Backward compatibility with features 001–003.

**Independent Test**: The full 001–003 test suite passes unchanged.

**Acceptance Scenarios**:

1. **Given** a runtime configured the existing single-session way, **When** tasks are run and
   streamed without naming a template, **Then** behavior is identical to before this feature.
2. **Given** a runtime with a session and templates, **When** a task names no template, **Then**
   it clones the unnamed default (session) base; **When** it names a template, **Then** it
   clones that template's base.
3. **Given** a runtime with templates but no session, **When** a task names no template,
   **Then** it fails with an argument error before admission (for a stream, at its first
   pull) and consumes no queue entry, slot, or session; no template is chosen automatically.

---

### User Story 5 - Deterministic lifecycle for all bases (Priority: P2)

Runtime creation, broken handling, and shutdown cover every template base session with the
same guarantees as today's single base.

**Why this priority**: Multiple owned sessions multiply leak risk (Principle V).

**Independent Test**: Create a runtime with three templates, run tasks, shut down; every
base was destroyed exactly once and no clone remains.

**Acceptance Scenarios**:

1. **Given** three templates, **When** shutdown completes, **Then** all three base sessions
   were destroyed exactly once and no task session remains.
2. **Given** a template whose base session cannot be created during runtime creation,
   **When** creation fails, **Then** the error is reported and every base session already
   created for that runtime is destroyed.
3. **Given** a clone failure on template A that marks its base untrusted, **When** it happens,
   **Then** the whole runtime becomes broken: waiting tasks on every template are refused,
   later tasks on every template are refused, tasks already running on any template (e.g. B)
   finish normally, and the snapshot reports broken.

---

### Edge Cases

- Duplicate template names: impossible to express when templates are given as a keyed
  collection; no separate validation is needed. Documented, not coded.
- Empty template set with no session: runtime creation fails with a configuration error; an
  unusable runtime is never created. An empty template set with a session is equivalent to the
  existing single-session runtime.
- Templates without a session, and a task that names no template: argument error, no admission,
  no automatic choice.
- One template's base creation fails while others succeed: creation fails with that error and
  the already-created bases are destroyed.
- Unknown template on a stream: stream creation stays lazy and side-effect free; the error
  appears on first consumption.
- Unknown template while the runtime is broken or closed: the existing broken/closed refusal
  and the unknown-template refusal are both valid; exactly one error is reported and nothing
  is consumed.
- Shutdown while tasks on several templates are running or queued: existing shutdown rules
  apply to all of them; every base is destroyed after all task sessions are cleaned up.
- A base's destroy throws during shutdown: existing policy (swallowed); the remaining bases
  are still destroyed and shutdown still resolves.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-301**: The runtime MUST accept a fixed set of named templates at creation time and hold
  exactly one warm base session per template. Each template is given as session
  configuration (the same kind the existing single-session setup accepts), and the runtime
  creates each base session itself.
- **FR-302**: The template set MUST be fixed for the runtime's lifetime; no registering,
  unregistering, replacing, or reloading after creation.
- **FR-303**: Each task (normal or streaming) MUST select exactly one template by exact name;
  the task's session MUST be a clone of that template's base and of no other.
- **FR-304**: Task execution MUST NOT change any template's base context, and no task may
  observe another template's context.
- **FR-305**: All templates MUST share the runtime's single concurrency limit and single FIFO
  queue; template identity MUST NOT affect admission order, rejection, cancellation, or
  timeout behavior.
- **FR-306**: Streaming tasks MUST keep the existing lazy semantics: template resolution and
  admission happen at the first pull, never at stream creation.
- **FR-307**: Selecting an unknown template MUST fail without entering the queue, taking a
  slot, cloning, or changing runtime state, using the smallest existing error mechanism.
- **FR-308**: Runtime creation MUST fail with a configuration error when templates are
  configured as an empty set and no session is given. Configurations without any templates
  keep the existing behavior (a default base is created from the optional session
  configuration).
- **FR-309**: If any template's base session cannot be created, runtime creation MUST fail
  with that error and destroy every base session already created for it.
- **FR-310**: Shutdown MUST destroy every template base session exactly once, after all queued
  and running tasks are handled under existing shutdown rules; repeated and concurrent
  shutdown calls keep the existing idempotent contract; destroy errors follow the existing
  swallow policy.
- **FR-311**: Broken state MUST stay runtime-wide: a clone failure that marks any template's
  base untrusted moves the runtime to broken under the existing rules (waiting and later tasks
  on all templates refused; running tasks on all templates finish), without automatic
  recovery and without per-template health state.
- **FR-312**: The runtime snapshot MUST keep its runtime-wide meaning (state, active, queued,
  limit, queue capacity) with no per-template fields.
- **FR-313**: A task MUST name its template through its per-task options (alongside the
  cancellation signal), for both normal and streaming tasks. The existing single-session
  configuration is the unnamed default template and is used when no template is named. A
  default exists when templates are not configured (existing behavior) or when a session is
  given together with templates. When templates are configured without a session, naming no
  template MUST fail with an argument error before admission (normal task) or at the first
  pull before admission (streaming task), consuming nothing; no template is selected
  automatically. Existing single-session applications MUST keep working unchanged.
- **FR-314**: The runtime owns every template base session under the existing ownership
  policy; no base session is shared with another runtime or destroyed twice, and no task
  session outlives runtime cleanup.
- **FR-315**: The feature MUST NOT add caches, eviction, TTLs, per-template queues or limits,
  priorities, routing, auto-selection, aliases, retries, recovery, per-template metrics,
  provider abstraction, or runtime dependencies.

### Key Entities

- **Template**: An application-chosen name plus the session configuration (including initial
  context) used to create one warm base session. Fixed at runtime creation.
- **Template Base Session**: The warm session created for a template; only ever cloned;
  owned and eventually destroyed by the runtime.
- **Task**: As before, plus the name of exactly one template it clones from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-301**: A developer can run tasks against at least three differently-configured
  templates through one runtime without creating additional runtimes.
- **SC-302**: In isolation tests across templates, 0 tasks observe another template's
  context and 0 base contexts change.
- **SC-303**: Under a burst of at least 100 tasks spread across 3 templates, running tasks
  never exceed the single limit, waiting tasks never exceed the single queue capacity, and
  admission order is preserved.
- **SC-304**: Unknown-template requests change the snapshot and clone count by 0.
- **SC-305**: After shutdown of a runtime with N templates, exactly N base sessions were
  destroyed and 0 task sessions remain.
- **SC-306**: All existing 001–003 tests pass without modification.

## Assumptions

- Builds on features 001–003; their lifecycle, queue, streaming, snapshot, and shutdown rules
  are reused, not redefined.
- Templates are given as a keyed collection, so duplicate names cannot be expressed.
- An unknown template, or a missing template where no default exists, is a caller programming
  error reported with the existing argument-error mechanism (`TypeError`, as used for invalid
  configuration), not a new task outcome kind; on a stream it surfaces at the first pull to
  keep creation lazy.
- The number of templates is small and fixed; no limit policy is added.
- No performance claim is made; no benchmark change is needed (Constitution III).
