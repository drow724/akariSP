# Feature Specification: Warm Base Session with Cloned Task Execution

**Feature Branch**: `001-warm-session-clone`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Build the first AkariSP MVP. Create and retain a warm base
browser language model session and execute isolated tasks by cloning that base session;
destroy every task session on success, failure, or cancellation; expose timing for
acquisition, prompt, and total task duration; a benchmark can compare
create → prompt → destroy against warm base → clone → prompt → destroy on the same workload."

## Clarifications

### Session 2026-09-26

- Q: 이번 MVP에서 동시에 실행되는 task 수에 상한을 둘까요? → A: Yes. A configurable
  concurrency limit with a caller-selectable overflow strategy (modeled on Spring
  `ThreadPoolTaskExecutor`): wait in a queue, reject immediately, or run immediately in the
  caller's own call with a new task session outside the limit. *(Revised in the 2026-09-26
  design review: v0.1 supports the queue plus **reject** only; caller-runs is deferred.)*
- Q: 실행 중에 base session을 더 이상 쓸 수 없게 되면 어떻게 할까요? → A: No automatic
  recovery. When a clone failure indicates the base session is invalid, the runtime becomes
  BROKEN: the current task fails, later submissions are rejected immediately, and the
  application recreates the runtime.
- Q: task가 실패하거나 취소되었을 때도 시간 정보를 알려줘야 할까요? → A: Yes, as
  task-level partial timing metadata on failed, cancelled, and rejected outcomes; fields for
  phases not reached are absent. Runtime-wide metrics are excluded from v0.1.
- Q: 앱이 동시성 설정을 따로 주지 않으면 기본값을 무엇으로 할까요? → A: limit 1, bounded
  queue of 32, overflow reject. Unbounded queues are not allowed in v0.1 (memory growth under
  bursts); 32 may be tuned later based on stress benchmark results.
- Q: 앱이 shutdown을 호출했을 때 이미 실행 중인 task는 어떻게 처리할까요? → A: Shutdown
  rejects waiting tasks, cancels running tasks (cancellation outcome), and completes only
  after every task session and the base session are destroyed. Graceful drain/wait is out of
  scope for v0.1.

### Design Review 2026-09-26

- `clone()` failing with `InvalidStateError` does not prove the browser reclaimed the base
  session; it means the runtime can no longer trust the base for new tasks. The runtime
  becomes broken; tasks already holding their own task session keep running.
- Overflow policy for v0.1 is **reject** only (caller-runs removed). The concurrency limit is
  a hard cap on concurrently running tasks.
- `shutdown()` is idempotent, including concurrent calls; all calls converge on one result.
- The benchmark reports the warm base's one-time creation cost separately; AkariSP's claim is
  amortizing session initialization across repeated tasks, not eliminating it.

## User Scenarios & Testing *(mandatory)*

The primary user is an **application developer** embedding browser-native language model
features in a web page. Measured baseline on the target browser: creating a new session
takes ~225 ms on average, while cloning an existing session takes ~0.24 ms.

### User Story 1 - Run isolated tasks from a warm base session (Priority: P1)

A developer initializes AkariSP once with session configuration and initial prompts
(e.g., a system instruction). AkariSP creates one warm base session and keeps it. For each
independent task, the developer submits a prompt; AkariSP gives the task its own copy of the
base session, runs the prompt, returns the result, and discards the copy. Tasks never see
each other's conversation and the base session never receives task prompts.

**Why this priority**: This is the entire value of the MVP: removing per-request session
setup cost without leaking context between tasks.

**Independent Test**: Initialize once, run two tasks whose prompts would influence each
other if context leaked (e.g., task A says "remember the word X", task B asks "what word
did I tell you?"), and confirm task B has no knowledge of X and both return results.

**Acceptance Scenarios**:

1. **Given** an initialized runtime with a system instruction, **When** a task prompt is
   submitted, **Then** the result reflects the system instruction and is returned to the
   caller.
2. **Given** task A has completed, **When** task B is submitted, **Then** task B starts from
   the base session's context only, with no content from task A.
3. **Given** a task completed successfully, **When** it finishes, **Then** its task session
   has been destroyed and cannot be used again.
4. **Given** several tasks submitted at the same time, **When** they run, **Then** each runs
   in its own task session and none affects another's result.

---

### User Story 2 - Cancel tasks and always clean up (Priority: P1)

A developer passes a cancellation signal with a task (e.g., the user navigated away or
pressed "stop"). When the signal fires, AkariSP stops the task, reports it as cancelled, and
destroys the task session. Task sessions are also destroyed when the prompt fails.

**Why this priority**: On-device model sessions are scarce resources; leaked sessions
degrade the whole page. Constitution Principles V and XI make deterministic cleanup
non-negotiable.

**Independent Test**: Submit tasks that (a) are cancelled mid-prompt, (b) are cancelled
before they start, and (c) fail during the prompt; confirm each surfaces the correct
outcome and that no task session remains alive afterward.

**Acceptance Scenarios**:

1. **Given** a running task, **When** its cancellation signal fires, **Then** the task ends
   with a cancellation outcome carrying the signal's reason, and its task session is
   destroyed.
2. **Given** a cancellation signal that has already fired, **When** a task is submitted with
   it, **Then** the task ends immediately with a cancellation outcome and no task session is
   created.
3. **Given** a task whose prompt fails, **When** the failure occurs, **Then** the original
   error is surfaced to the caller and the task session is destroyed.
4. **Given** any task outcome (success, failure, cancellation), **When** the task ends,
   **Then** the base session remains usable for subsequent tasks.

---

### User Story 3 - Measure the warm path against the cold path (Priority: P2)

A developer or maintainer runs a benchmark that executes the same workload two ways:
(cold) create a new session → prompt → destroy, and (warm) warm base → clone → prompt →
destroy. The warm base's creation is a real one-time startup cost and is reported
separately, so the result shows how that cost is amortized over repeated tasks rather than
implying it disappears. Each task reports its acquisition time, prompt duration, and total
duration so the runtime's own overhead can be separated from model inference time.

**Why this priority**: Constitution Principle III requires performance claims to be backed
by reproducible measurements. The MVP's value claim must be proven, not asserted.

**Independent Test**: Run the benchmark with a fixed workload and iteration count; confirm
it outputs per-path statistics (at least median and p95) for every measure listed in
FR-013, plus the environment details needed to reproduce the run.

**Acceptance Scenarios**:

1. **Given** a completed task, **When** the caller inspects its result, **Then** it includes
   queue wait time, acquisition time, prompt duration, and total task duration.
2. **Given** a task cancelled while waiting in the queue, **When** the caller inspects the
   cancellation outcome, **Then** it includes queue wait time and total duration, and
   acquisition time and prompt duration are absent.
3. **Given** the benchmark is run, **When** it completes, **Then** it reports both paths using
   identical prompts, configuration, and iteration counts.
4. **Given** the per-task timings, **When** queue wait, acquisition, and prompt durations are
   subtracted from total duration, **Then** the remainder represents AkariSP's own overhead.
5. **Given** the benchmark report, **When** a reader compares paths, **Then** the warm base's
   one-time creation time is shown on its own and is not hidden from the warm path.

---

### User Story 4 - Bound concurrency with a bounded queue (Priority: P2)

A developer configures the maximum number of tasks that may run at once and how many extra
tasks may wait. When both are full, a new submission is **rejected** immediately. Setting
the queue capacity to zero rejects as soon as the limit is reached. The limit is a hard cap:
no task ever runs outside it.

**Why this priority**: On-device models share limited device resources; without a bound, a
burst of tasks degrades every task (Constitution Principle XI: backpressure over features).

**Independent Test**: Configure a limit of 2 and queue capacity of 1, submit 5 long tasks,
and confirm running count never exceeds 2, at most 1 waits, and the remaining 2 submissions
are rejected.

**Acceptance Scenarios**:

1. **Given** limit N and N tasks running, **When** another task is submitted and the queue
   has room, **Then** it waits and starts in submission order as soon as a running task ends.
2. **Given** limit N and a full queue, **When** another task is submitted, **Then** it fails
   immediately with a rejection error and no task session is created.
3. **Given** a waiting task, **When** its cancellation signal fires, **Then** it leaves the
   queue, ends as cancelled, and no task session is created.
4. **Given** a task that waited, **When** it completes, **Then** its timing includes the time
   spent waiting.

---

### User Story 5 - Shut down the runtime (Priority: P3)

When the developer no longer needs the runtime (e.g., the feature is unmounted), they shut
it down. Waiting tasks are rejected, running tasks are cancelled, all task sessions and the
base session are destroyed, and only then does shutdown complete. Further task submissions
are rejected.

**Why this priority**: Required for a complete lifecycle (Principle V) but rarely on the
critical path.

**Independent Test**: Initialize, start one long task and queue another, shut down, and
confirm the running task ends as cancelled, the queued task is rejected, no session remains
alive when shutdown completes, and a new submission is rejected with a clear error.

**Acceptance Scenarios**:

1. **Given** an initialized runtime, **When** it is shut down, **Then** the base session is
   destroyed.
2. **Given** a shut-down runtime, **When** a task is submitted, **Then** the submission is
   rejected with an error stating the runtime is closed.
3. **Given** running and waiting tasks, **When** shutdown is called, **Then** running tasks
   end with a cancellation outcome, waiting tasks are rejected
   with a runtime-closed error, and shutdown completes only after every task session and the
   base session are destroyed.
4. **Given** shutdown has already been called (in progress or completed), **When** it is
   called again, **Then** it completes without error, with the same result as the first call,
   and performs no additional cleanup.
5. **Given** a ready runtime, **When** shutdown is called several times concurrently, **Then**
   all calls settle together with the same result and cleanup runs once.

---

### Edge Cases

- Base session creation fails (model unavailable, still downloading, unsupported browser):
  initialization fails with the underlying error and no runtime is usable.
- Cloning the base session fails for a transient reason: the task fails with the
  underlying error; no task session is left behind; the runtime stays usable.
- Cloning fails with an error indicating the base session can no longer be trusted for new
  tasks (whatever the underlying cause): the current task fails, the runtime becomes broken,
  waiting tasks are rejected with a runtime-broken error, and new submissions are rejected
  immediately. Tasks that already hold their own task session keep running and may complete
  successfully.
- Limit 2: task A has cloned and is prompting when task B's clone fails that way. B fails,
  the runtime becomes broken, queued and new tasks are rejected, A completes normally, and a
  later shutdown applies the normal shutdown rules to anything still running.
- Shutdown on a broken runtime: allowed; cleans up whatever remains without error.
- Cancellation fires while the clone is in progress: the task ends as cancelled. Whether the
  clone then rejects or still resolves later, no task session leaks: a late-arriving clone is
  destroyed immediately and never prompted, and the cancelled outcome is delivered only after
  that destroy and the slot release.
- A timeout fires during queue wait, acquisition, or prompt: the task ends as cancelled with
  a timeout reason, any task session already created is destroyed, and timing contains only
  the phases completed before the timeout.
- Cancellation fires after the prompt has already completed: the task keeps its successful
  result; cleanup still occurs exactly once.
- Shut down while tasks are in flight: running tasks are cancelled and their task sessions
  destroyed before shutdown completes; there is no graceful drain.
- A running task's prompt completes at the same moment shutdown is called: the task ends with
  exactly one outcome (success or cancellation), never both.
- Destroying a task session itself throws: the error does not replace the task's original
  outcome.
- Shut down while tasks are waiting in the queue: waiting tasks are rejected with a
  runtime-closed error and never create a task session.
- Invalid concurrency configuration (limit below 1 or non-integer; queue capacity negative,
  non-integer, or unbounded): initialization fails with a clear configuration error.
- A running task fails or is cancelled: once its task session is destroyed its slot is
  released and the next waiting task starts.
- The same cancellation signal is reused across many tasks or for the life of the app: the
  runtime leaves no abort listeners behind on it once each task has left the queue.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The runtime MUST create exactly one base session at initialization from
  caller-supplied session configuration and initial prompts.
- **FR-002**: The runtime MUST retain the base session and use it only as a template; task
  prompts MUST NOT be sent to the base session.
- **FR-003**: Each submitted task MUST execute in a new task session cloned from the base
  session.
- **FR-004**: A task session MUST be destroyed exactly once when its task ends, whether the
  task succeeded, failed, or was cancelled.
- **FR-005**: A task session MUST NOT be reused by any other task or returned to any
  reusable pool.
- **FR-006**: Callers MUST be able to supply a standard cancellation signal per task; when it
  fires, the task MUST end with a cancellation outcome carrying the signal's reason. A
  time-based signal (timeout) is a cancellation like any other: the outcome is cancelled and
  the reason identifies it as a timeout.
- **FR-007**: A task submitted with an already-fired cancellation signal MUST end without
  creating a task session.
- **FR-008**: Task failures MUST surface the original underlying error to the caller.
- **FR-009**: Each successful task result MUST include the prompt response plus task
  timing: queue wait time, acquisition time, prompt duration, and total task duration.
- **FR-009a**: Failed, cancelled, and rejected task outcomes MUST carry task timing
  collected up to the point the task ended. A phase's field has a value only if that phase
  completed (e.g. acquisition counts as completed when a task session was obtained, even if
  the task is then cancelled); fields for phases that did not complete MUST be absent
  (undefined) rather than zero. Total duration is always recorded.
- **FR-009b**: A task's outcome MUST be delivered only after every resource it owned has been
  cleaned up: its task session (if any, including one obtained after cancellation) is
  destroyed and its slot released before the outcome settles.
- **FR-010**: Multiple tasks MUST be able to run concurrently, each in its own task session.
- **FR-010a**: The runtime MUST accept a concurrency limit (integer ≥ 1) and a finite queue
  capacity (integer ≥ 0). Unbounded queue capacity MUST NOT be accepted. The only overflow
  behavior in v0.1 is **reject**.
- **FR-010b**: Tasks that cannot start immediately MUST wait in the queue while it has room
  and become running tasks in submission order (FIFO) as running tasks end.
- **FR-010c**: When the limit is reached and the queue is full, a submission MUST fail
  immediately with a distinguishable rejection error and create no task session.
- **FR-010e**: A waiting task whose cancellation signal fires MUST be removed from the queue
  and end as cancelled without creating a task session. Any listener the runtime registers on
  a caller's signal MUST be removed as soon as the task leaves the queue for any reason
  (start, cancellation, rejection, shutdown, or broken transition), so reused signals do not
  accumulate listeners.
- **FR-010f**: The concurrency limit MUST be an absolute cap on running tasks. A task becomes
  a running task when it acquires a slot, before its clone starts, and stops being one only
  after its task session (if one was created) has been destroyed:
  slot acquire → clone start → clone complete → prompt → task session destroy → slot release.
  No task clones, prompts, or holds a task session outside this lifecycle.
- **FR-010g**: When not configured, the runtime MUST default to limit 1 and queue capacity
  32; overflow is always **reject**.
- **FR-011**: The runtime MUST provide a shutdown operation that rejects tasks still waiting
  in the queue with a runtime-closed error, cancels all running tasks with a cancellation
  outcome whose reason is identifiable as an abort (`AbortError`; the message text is not
  part of the contract), destroys every task session and the base session, and completes only
  after all of that cleanup has finished. Subsequent submissions MUST be rejected with a
  runtime-closed error.
- **FR-011a**: When a clone failure indicates the base session can no longer be trusted for
  new tasks, the runtime MUST fail the current task with the underlying error, enter a
  broken state, reject all waiting tasks and all later submissions immediately with a
  distinguishable runtime-broken error, and MUST NOT attempt to recreate the base session.
  Tasks that already hold their own task session MUST NOT be interrupted by this transition.
- **FR-011b**: The runtime MUST expose its current state (ready, broken, closed) so the
  application can decide to recreate it.
- **FR-011c**: Shutdown MUST be idempotent: calling it again after it completed, while it is
  in progress, or concurrently MUST NOT raise an error or repeat cleanup, and every call MUST
  settle with the same result once cleanup is complete.
- **FR-012**: The runtime MUST support non-streaming prompt execution. Streaming is out of
  scope for this feature.
- **FR-013**: A benchmark MUST be provided that runs the cold path (create → prompt →
  destroy) and the warm path (warm base → clone → prompt → destroy) on the same workload and
  reports, separately: cold session create time, cold prompt time, cold total time, warm
  base creation time (one-time startup cost), warm acquisition time, warm prompt time, warm
  steady-state total time, and AkariSP's own queue/scheduler overhead.
- **FR-014**: The core MUST NOT depend on any UI framework, LLM orchestration library, or
  agent abstraction, and MUST NOT persist any data.

### Key Entities

- **Runtime**: Owns the base session for its lifetime; accepts tasks; can be shut down.
  States: **ready** (accepts tasks) → **broken** (base no longer trusted; rejects tasks) or
  **closed** (shut down; rejects tasks). broken → closed on shutdown. No transition back to
  ready; the application creates a new runtime instead.
- **Base Session**: The warm, pre-configured session created once at initialization; only
  ever cloned, never prompted by tasks.
- **Task**: One independent unit of work: a prompt, an optional cancellation signal, and an
  outcome (success, failure, or cancellation). A task is **waiting** while queued and a
  **running task** from slot acquisition until its task session (if any) is destroyed
  (FR-010f).
- **Task Session**: A single-use clone of the base session owned by exactly one task and
  destroyed when that task ends.
- **Task Timing**: Execution metadata for benchmarking and observability: queue wait time,
  acquisition time, prompt duration, and total task duration for one task. Complete on
  success; partial on failure, cancellation, or rejection (unreached phases absent).
- **Concurrency Policy**: Concurrency limit (cap on running tasks) and queue capacity set when the runtime is
  initialized; defaults limit 1, queue capacity 32; overflow is always reject.
- **Benchmark Report**: Per-path (cold vs. warm) statistics for the same workload, the warm
  base's one-time creation time, and environment details (browser, version, hardware) for
  reproducibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the same device and workload, median per-task acquisition time on the warm
  path is at least 10× lower than median session creation time on the cold path, with the
  warm base's one-time creation time reported alongside.
- **SC-002**: Median runtime overhead per task (total duration minus queue wait time minus
  acquisition time minus prompt duration) is under 1 ms.
- **SC-003**: Across a run of at least 100 tasks mixing successes, failures, and
  cancellations, 100% of task sessions are destroyed and zero remain alive afterward.
- **SC-004**: In context-isolation tests, 0 tasks observe content from any other task.
- **SC-005**: A maintainer can rerun the benchmark from its documented procedure and obtain a
  report with both paths without modifying any code.
- **SC-006**: Under a burst of at least 100 submissions exceeding limit + queue capacity,
  running tasks never exceed the limit and every submission ends as completed, rejected, or
  cancelled (0 lost or hung tasks).

## Assumptions

- Target environment is a browser that exposes a native language model API with session
  create, clone, prompt, and destroy operations (currently Chrome's Prompt API).
- The model is already available on the device; model download progress and availability
  UX are out of scope beyond surfacing the underlying error.
- One base session per runtime instance; applications needing different configurations
  create separate runtime instances.
- Overflow is reject only in v0.1; caller-runs and discard-style policies are out of scope.
- The default queue capacity of 32 is provisional and may be tuned based on stress benchmark
  results; concurrency policy is fixed for the runtime's lifetime (no runtime reconfiguration).
- Which clone errors mean "base no longer trusted" (vs. transient) is determined at planning
  time from the provider's documented error types.
- No per-task timeout option; callers achieve timeouts with a time-based cancellation
  signal.
- Graceful shutdown (waiting for running tasks to finish) is out of scope for v0.1;
  applications that need it await their tasks before calling shutdown.
- Runtime-wide metrics (aggregate counts, queue depth, etc.) are out of scope for v0.1;
  only task-level timing is provided.
- The provider honors the cancellation signal contract: after cancellation, in-progress
  clone and prompt operations eventually settle (resolve or reject). AkariSP v0.1 does not
  add a watchdog or recover from a provider defect that leaves such an operation pending
  forever after abort. This does not assume operations finish within any bound during
  normal execution.
- Only one provider (the browser's native language model) is supported; no provider
  abstraction is introduced (Constitution Principle VIII).
- The benchmark lives outside the core public API and runs in the target browser.
