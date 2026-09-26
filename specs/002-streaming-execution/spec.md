# Feature Specification: Streaming Task Execution

**Feature Branch**: `002-streaming-execution`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Add streaming execution support to AkariSP: one streaming API on the
existing runtime (e.g. runtime.stream(input, options)) that yields incremental model output,
obeys the same concurrency limit, queue, cancellation, timeout, broken-state, and shutdown rules
as run(), and always destroys the cloned task session, including when the consumer stops early."

## Clarifications

### Session 2026-09-26

- Q: streaming task는 언제 대기열에 들어가야 할까요? → A: Lazily. The stream operation
  returns a lazy asynchronous iterable; task admission starts at the first pull. A stream that
  is created but never consumed uses no queue entry, slot, or session. Queue order and
  rejection/closed/broken checks are evaluated at the first pull.
- Q: 정상적으로 끝난 스트림의 시간 정보를 호출자가 어떻게 읽게 할까요? → A: The stream exposes a
  read-only timing value that is undefined until the stream's lifecycle and resource cleanup are
  fully complete, then holds the final task timing. No partial values are exposed while
  running. On failure it is the same final timing carried by the error. Time to first chunk
  is out of scope for v0.2.

## User Scenarios & Testing *(mandatory)*

The primary user is an **application developer** who already uses the AkariSP runtime
(feature 001) and wants to show model output as it is produced instead of waiting for the
full response. Every lifecycle guarantee of feature 001 still applies; this feature only
changes how output is delivered.

### User Story 1 - Consume output incrementally (Priority: P1)

A developer starts a streaming task with a prompt and reads the output chunk by chunk with
the language's standard asynchronous iteration. When the model finishes, iteration ends
and the task's session has already been cleaned up.

**Why this priority**: This is the feature's entire user value.

**Independent Test**: Start a streaming task against a model that produces three chunks;
iterate to the end; confirm the three chunks arrive in order, iteration ends normally, and
no task session remains alive.

**Acceptance Scenarios**:

1. **Given** a ready runtime, **When** the developer iterates a streaming task, **Then** each
   chunk is delivered in the order the model produced it.
2. **Given** a streaming task that completes, **When** iteration ends, **Then** its task
   session has been destroyed and its concurrency slot released.
3. **Given** two streaming tasks, **When** both run, **Then** each uses its own task session
   and neither sees the other's context (same isolation as non-streaming tasks).

---

### User Story 2 - Stop early without leaking (Priority: P1)

A developer stops reading a stream before it finishes, for example by leaving the loop once
enough text has arrived. AkariSP stops the model, destroys the task session, and frees the
slot so the next waiting task can start.

**Why this priority**: Early exit is the most common way streams end in UIs; a leak here
exhausts the concurrency limit.

**Independent Test**: With a limit of 1 and one task waiting, start a long stream, leave the
loop after the first chunk, and confirm the task session is destroyed, the waiting task
starts, and leaving the loop completes only after that cleanup.

**Acceptance Scenarios**:

1. **Given** an active streaming task, **When** the consumer leaves the loop early, **Then**
   the model output is stopped, the task session is destroyed, and the slot is released
   before the loop exit completes.
2. **Given** an early exit, **When** it completes, **Then** no error is raised to the
   consumer (stopping early is not a failure).

---

### User Story 3 - Cancellation, timeout, failure, and shutdown clean up (Priority: P1)

A developer passes a cancellation signal (possibly time-based). If it fires, the model fails
mid-stream, or the runtime is shut down, iteration ends with the same error kinds as
non-streaming tasks, and no task session leaks, even if the consumer is not currently
reading.

**Why this priority**: Same reliability bar as feature 001 (Constitution Principles V, XI).

**Independent Test**: Run streams that are (a) cancelled mid-stream, (b) timed out,
(c) failed by the model mid-stream, (d) cancelled while the clone is still being created,
(e) interrupted by shutdown while the consumer is paused; confirm the error kind for each and
zero live task sessions afterward.

**Acceptance Scenarios**:

1. **Given** an active stream, **When** the caller's signal fires, **Then** iteration ends
   with a cancellation error carrying the signal's reason, and the task session is destroyed.
2. **Given** an active stream with a time-based signal, **When** time runs out, **Then**
   iteration ends with a cancellation error identifiable as a timeout.
3. **Given** an active stream, **When** the model fails mid-stream, **Then** iteration ends
   with a failure error carrying the original error; chunks already delivered stay delivered.
4. **Given** cancellation fires while the task session is still being created, **When** the
   session arrives late, **Then** it is destroyed without producing output, before the
   task is considered complete.
5. **Given** active streams, **When** the runtime shuts down, **Then** each stream ends with a
   cancellation error identifiable as an abort, and shutdown completes only after every
   streaming task session is destroyed, whether or not its consumer is currently reading.

---

### User Story 4 - Same queue and admission rules as run() (Priority: P2)

Streaming and non-streaming tasks share one concurrency limit and one waiting queue. A
streaming task waits, is rejected, or is refused on a broken or closed runtime exactly as a
non-streaming task would be.

**Why this priority**: One scheduler; mixing task kinds must not bypass backpressure.

**Independent Test**: With limit 1 and queue capacity 1, start one stream, one normal task,
and a second stream; confirm the normal task waits, the second stream is rejected, and the
normal task starts only after the first stream's session is destroyed.

**Acceptance Scenarios**:

1. **Given** the limit is reached and the queue has room, **When** a stream starts, **Then**
   it waits in submission order with other tasks.
2. **Given** the limit is reached and the queue is full, **When** a stream starts, **Then**
   it ends immediately with a rejection error and no task session is created.
3. **Given** a broken or closed runtime, **When** a stream starts, **Then** it ends
   immediately with the matching error and the base session is not used.
4. **Given** a waiting stream, **When** its signal fires, **Then** it leaves the queue and
   ends as cancelled without creating a task session.

---

### Edge Cases

- A stream object is created but never iterated: no task is admitted, no queue entry, slot, or
  session is used, and nothing needs cleanup.
- A stream is created while the runtime is ready but first iterated after shutdown or a
  broken transition: the first pull fails with the closed or broken error.
- The consumer stops pulling chunks but does not leave the loop: the task keeps its slot
  (it is still running) until the consumer resumes, leaves, cancels, or shutdown occurs.
- A stream is iterated a second time: the second iteration fails immediately; a streaming
  task is single-use like any task.
- The model finishes and cancellation fires at the same moment: the stream ends with exactly
  one outcome (normal end or cancellation), never both.
- The consumer leaves the loop at the same moment cancellation fires: cleanup happens once;
  no error is raised to a consumer that already left.
- Destroying the task session throws: the stream's outcome is unchanged.
- The clone fails with the error that marks the base untrusted: the stream ends with the
  broken error and the runtime becomes broken, as for non-streaming tasks.
- The model produces zero chunks: iteration ends normally with no chunks.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-101**: The runtime MUST provide exactly one streaming execution operation that takes
  the same input and options as the non-streaming operation and returns output as an
  asynchronously iterable sequence of text chunks.
- **FR-102**: A streaming task MUST execute in its own task session cloned from the base
  session and MUST NOT send input to the base session.
- **FR-103**: A streaming task MUST be admitted at the first pull of its iteration. Creating
  a stream object without iterating it MUST NOT admit a task or use a queue entry, slot, or
  session. Admission checks (runtime state, pre-aborted signal, queue capacity) and queue
  order are evaluated at that first pull, not when the stream object is created.
- **FR-104**: Streaming and non-streaming tasks MUST share one concurrency limit and one
  FIFO waiting queue, with identical admission, rejection, broken, and closed rules.
- **FR-105**: A streaming task MUST hold its slot from before its clone starts until its task
  session (if one was created) has been destroyed.
- **FR-106**: The task session MUST be destroyed exactly once when the stream ends for any
  reason: normal completion, model error, caller cancellation, timeout, runtime shutdown, or
  the consumer leaving iteration early.
- **FR-107**: When the consumer leaves iteration early, the runtime MUST stop the model
  output, destroy the task session, and release the slot before the loop exit completes, and
  MUST NOT raise an error to the consumer.
- **FR-108**: Cancellation, timeout, model failure, rejection, broken, and closed outcomes
  MUST end iteration with the same error kinds, causes, and partial timing rules as the
  non-streaming operation.
- **FR-109**: Cleanup on cancellation, timeout, and shutdown MUST NOT depend on the consumer
  pulling the next chunk.
- **FR-110**: If cancellation races with clone completion, a late-arriving task session MUST
  be destroyed without producing output before the task is considered complete.
- **FR-111**: Shutdown MUST cancel active streaming tasks and complete only after every
  streaming task session is destroyed and every slot released.
- **FR-112**: A stream MUST be consumable once; a second iteration MUST fail immediately
  without admitting a task.
- **FR-113**: A stream MUST expose a read-only timing value that is undefined until the
  task's lifecycle and resource cleanup (session destroyed, slot released) are complete, and
  then holds the final task timing using the existing fields and rules (only completed phases
  set, total always set). The prompt phase spans from the start of output to the model's last
  chunk; it is set only if the model finished. No partial timing is exposed while the stream
  runs. When the stream ends with an error, the exposed timing is the same final timing the
  error carries.
- **FR-114**: The existing non-streaming operation's behavior MUST remain unchanged.
- **FR-115**: The feature MUST NOT add runtime dependencies, callback-style chunk APIs,
  retries, automatic recovery, additional providers, or runtime-wide metrics.

### Key Entities

- **Streaming Task**: A task whose output is delivered as a sequence of text chunks. Same
  lifecycle as any task (waiting → running task → ended), plus one extra way to end:
  the consumer leaving early.
- **Stream**: The object returned to the caller; single-use and lazy (admits its task at the
  first pull); exposes the task's final timing once the task has fully ended and been cleaned
  up, and nothing before that.
- **Chunk**: One increment of model output text, delivered in production order.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-101**: A developer can display model output as it arrives using only the language's
  standard asynchronous iteration, with no manual session handling.
- **SC-102**: Across at least 100 streaming tasks ending by completion, early exit,
  cancellation, timeout, model failure, and shutdown, 100% of task sessions are destroyed and
  zero remain alive afterward.
- **SC-103**: After an early exit, the next waiting task starts without any further action
  from the consumer.
- **SC-104**: Under a burst of mixed streaming and non-streaming tasks exceeding limit + queue
  capacity, running tasks never exceed the limit and every task ends as completed, rejected,
  or cancelled.
- **SC-105**: All existing non-streaming tests pass unchanged.
- **SC-106**: The streaming feature adds no runtime dependencies and exactly one public
  operation.

## Assumptions

- Builds on feature 001 (`specs/001-warm-session-clone/`); its lifecycle, queue, timing,
  error, broken-state, and shutdown rules are reused, not redefined.
- The provider exposes a streaming prompt operation that yields text increments (deltas) and
  honors the cancellation signal contract assumed in feature 001.
- Chunks are passed through as the provider produces them; AkariSP does not buffer, merge, or
  re-split them.
- A consumer that stops pulling without leaving the loop keeps its slot; AkariSP does not
  add an idle timeout. Callers that need one use a time-based cancellation signal.
- Time to first chunk is out of scope for v0.2 (not a timing field).
- A consumer that leaves early ends a task whose model output did not finish, so its final
  timing has no prompt duration.
- Streaming is available only through asynchronous iteration; no callback API.
