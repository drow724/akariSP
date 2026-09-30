# Feature Specification: Task-Scoped Provider Options Boundary Validation

**Feature Branch**: `013-task-scoped-provider-options`

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "Feature 013 — Per-task Provider Options / Structured Output Boundary
Validation. Research-first validation of whether AkariSP needs a minimal provider-neutral
task-scoped execution-options boundary, motivated by structured-output failures (JSON wrapped in
Markdown code fences) observed during real consumer dogfooding of akarisp@0.1.0-alpha.2. Not 'add
responseConstraint support'. Outcomes: NO_CHANGE / INTERNAL_ONLY / PUBLIC_MINIMAL_EXTENSION."

## Context

### The consumer finding (input, not reproduced in this repository)

A consumer application built only on the published `akarisp@0.1.0-alpha.2` API (`createRuntime`,
`run`, `snapshot`, `shutdown`, `TaskError`) exercised the lifecycle contract as designed. During
structured-output work, the model sometimes returned the expected JSON wrapped in a Markdown code
fence, so the consumer's parse failed and it issued a fallback request.

This finding is reported by the maintainer from the consumer's dogfooding. Its raw evidence is not
in this repository. This feature treats it as the motivating observation and must reproduce it, or
fail to, under controlled conditions (R1) before relying on it.

### Facts already on record (to be re-verified by research)

| Fact | Evidence class | Source |
|---|---|---|
| The Prompt API defines a structured-output constraint and an option controlling whether that constraint is included in the model input. Both are **prompt options**; the creation options do not contain them | PLATFORM_SPECIFICATION | `webmachinelearning/prompt-api` `9fcb9a4`, read 2026-09-27 for the 012 research |
| AkariSP starts each task and then prompts it with only the task's cancellation signal. `run()` and `stream()` accept only a signal and a template name | SOURCE | `src/core/runtime.ts` |
| Creation options (`session`, each template) reach the provider unchanged, and the core never inspects them | SPEC / TEST | 004, 005, 011; "create receives the session and template config objects unchanged" |
| For WebLLM, a template is request configuration that is spread into every request of that template | SPEC / SOURCE | 007 (E9), `src/webllm/runtime.ts` |
| Templates are a small set, fixed for the runtime's lifetime, with no caches, eviction, or TTLs | SPEC | 004 FR-301, FR-302, FR-315 |

So the possible asymmetry is: provider configuration fixed at runtime or template creation can be
expressed, but provider configuration for a single task might not be. Whether that asymmetry is a
real gap, and whether AkariSP should close it, is the question this feature answers.

## Clarifications

### Session 2026-09-30

- Q: What sample size and "material improvement" rule should the R1 comparison use? → A: 30
  measured attempts per arm. The treatment "materially improves" the failure only if the control
  reproduces at least 1 structured-parse failure, the treatment has at most half of the control's
  parse failures, the treatment has 0 code-fence failures, and the treatment adds no new
  provider-error category. If the control reproduces no failure, R1 is "failure not reproduced";
  the consumer's report alone does not count (FR-1303, FR-1304).
- Q: May a public extension be chosen when only one supported provider cannot express the
  capability today (for example Prompt API is R3 A/B while WebLLM is R3 C)? → A: Yes, provided the
  new boundary is described in provider-neutral terms and its meaning for every other provider
  (ignored, rejected, or forwarded) is stated explicitly (FR-1310, FR-1313).
- Q: If R1 shows material improvement, when does the consumer's workaround still make the outcome
  NO_CHANGE? → A: Apply one fixed workaround rule after the fact to the control arm's raw outputs:
  remove one outer Markdown code fence, then apply the same parsing rule. If every control parse
  failure is recovered, the workaround is sufficient and the outcome is NO_CHANGE; if any failure
  is not recovered, this condition does not hold (FR-1304a, FR-1310).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Establish whether the native constraint fixes the observed failure (Priority: P1)

A maintainer compares, on the same structured-output workload in real Chrome, prompt-only
formatting instructions (control) against the browser's native task-scoped structured-output
constraint (treatment). The goal is to learn whether the native mechanism materially removes the
code-fence failure the consumer hit.

**Why this priority**: Every later decision depends on it. If the native mechanism does not help,
there is nothing for AkariSP to expose and the feature ends with NO_CHANGE.

**Independent Test**: Run the comparison harness in a real browser with the model available. It
produces per-attempt raw records and a per-arm summary that alone answer R1.

**Acceptance Scenarios**:

1. **Given** a browser where the model is available, **When** the same workload runs N times per
   arm, **Then** each attempt is recorded with its raw output, parse outcome, failure category, and
   latency, and the arms are compared by the decision rule in FR-1304.
2. **Given** the control arm never shows the failure, **When** the comparison ends, **Then** the
   result is recorded as "failure not reproduced", and that result alone cannot justify a public
   extension.
3. **Given** the treatment raises a provider error in some attempts, **When** results are
   summarized, **Then** those errors are counted and categorized separately from parse failures.

---

### User Story 2 - Decide the narrowest boundary, or none (Priority: P1)

A maintainer uses the R1 result, the provider contracts, and the existing feature contracts to
determine which of NO_CHANGE, INTERNAL_ONLY, or PUBLIC_MINIMAL_EXTENSION applies. The decision is
recorded with its evidence.

**Why this priority**: This decision is the deliverable of the feature. Implementation, if any, is
a consequence of it.

**Independent Test**: Reading the research record alone, a reviewer can see answers to R2 to R7,
the chosen outcome, and the criterion from FR-1310 that selected it.

**Acceptance Scenarios**:

1. **Given** R1 shows no material improvement, **When** the outcome is decided, **Then** it is
   NO_CHANGE and no production source changes.
2. **Given** R1 shows material improvement but the capability can already be expressed with
   existing templates or session configuration for every provider, **When** the outcome is
   decided, **Then** it is NO_CHANGE, with the existing path documented as the answer.
3. **Given** every PUBLIC_MINIMAL_EXTENSION condition holds, **When** the outcome is decided,
   **Then** the recorded decision names the capability in provider-neutral terms and states its
   ownership semantics, before any API shape is chosen in planning.

---

### User Story 3 - Existing callers and lifecycle are unaffected (Priority: P2)

Only if the outcome is PUBLIC_MINIMAL_EXTENSION or INTERNAL_ONLY: an application that never uses
the new capability sees identical behavior. An application that uses it keeps every lifecycle
guarantee it has today.

**Why this priority**: A change is acceptable only if it is additive and preserves the validated
contract. It is conditional on the P1 stories.

**Independent Test**: The existing test suites pass unchanged, and focused tests cover invariants
1 to 10 (FR-1320) for tasks that use the capability, including cross-task isolation.

**Acceptance Scenarios**:

1. **Given** existing calls with only a signal, a template, or no options, **When** they run,
   **Then** their outcomes, timing fields, errors, and snapshot values are unchanged.
2. **Given** two tasks where only the first supplies task-scoped options, **When** both complete,
   **Then** the second task's provider call receives none of the first task's options.
3. **Given** a task whose options are invalid and can be rejected before admission, **When** it is
   submitted, **Then** it is rejected without taking a queue entry or slot.

### Edge Cases

- The control arm reproduces the failure only rarely, for example once in N attempts. The result
  is reported as observed. It is not extrapolated into a rate claim, and FR-1304 decides.
- The treatment removes code fences but produces output that is well-formed yet does not match the
  schema. This is counted as a structured-output failure, not a success.
- The treatment makes the browser reject the prompt, for example with an unsupported or invalid
  constraint. This is a provider error, categorized separately.
- The workaround (strip one outer fence, then parse) recovers every control failure. By FR-1304a
  this is the "workaround sufficient" arm of NO_CHANGE. Implementing that workaround in AkariSP
  remains a non-goal.
- WebLLM already expresses an equivalent request option through template configuration. Research
  must say whether a per-task path would override template semantics (R5, R6).
- A caller mutates an options object after submitting a task, or reuses one object across tasks.
  The ownership semantics required by FR-1330 must define the outcome.
- A task is cancelled while queued or while starting, and it carried options. The cancellation
  outcome is unchanged and no options reach the provider.
- A stream is created with options but never pulled. Nothing is admitted and nothing reaches the
  provider (lazy admission).

## Requirements *(mandatory)*

### Research requirements (R1–R7)

- **FR-1301 (R1, method)**: Research MUST run a controlled comparison in a real browser with the
  model already available, with no model download. It compares:
  - **Control**: prompt-only formatting instructions.
  - **Treatment**: the browser-native task-scoped structured-output constraint.

  Both arms use the same workload, prompt text, base configuration, and parsing rule, with the arm
  order interleaved. Because AkariSP cannot pass the treatment today, the treatment MUST run
  directly on native task sessions in a research-only harness, not through a modified AkariSP.
- **FR-1302 (R1, record)**: Each attempt MUST record:
  - the raw output;
  - the parse outcome under one fixed, written parsing rule;
  - a failure category: code fence, well-formed but not matching the schema, not well-formed,
    empty, or provider error, with the name and message of the error;
  - completion latency;
  - whether a fallback request would have been needed.

  The record MUST also include the browser version, OS, model availability state, number of
  repetitions, the exact constraint shape, and the exact parsing rule. Raw results MUST be kept
  unchanged.
- **FR-1303 (R1, sample)**: Each arm MUST have at least 30 measured attempts per workload, after
  warmup attempts that are excluded from the results. Results MUST be reported as counts per
  category, not as general rates or claims about other environments.
- **FR-1304 (R1, decision rule)**: The treatment "materially improves" the failure only if all of
  the following hold:
  - the control arm reproduces at least one code-fence or other structured-parse failure;
  - the treatment has at most half the control arm's structured-parse failures, and zero code-fence
    failures;
  - the treatment adds no provider-error category that the control does not have.

  If the control arm reproduces no failure, R1 is recorded as "failure not reproduced". The
  consumer's reported failure does not substitute for a reproduction in the control arm. The
  sample size and this rule are fixed before measurement and not changed after results are seen.
- **FR-1304a (R1, workaround check)**: Research MUST apply one fixed workaround rule after the fact
  to the control arm's recorded raw outputs: remove one outer Markdown code fence, if present, then
  apply the same parsing rule as FR-1302. The workaround is **sufficient** only if it recovers
  every control-arm parse failure. The rule is written before measurement, and it is research
  analysis only, never AkariSP behavior (FR-1340).
- **FR-1305 (R2, scope)**: Research MUST determine, from the current provider specification and
  from real-browser behavior, whether each relevant capability is creation-scoped, prompt-scoped,
  both, or dependent on the browser version. Current AkariSP code is not evidence of scope.
- **FR-1306 (R3, narrowest gap)**: Research MUST classify the gap as exactly one of:
  - A: one missing provider-specific feature;
  - B: a general inability to forward task-scoped provider configuration;
  - C: already expressible with templates or session configuration;
  - D: not AkariSP's responsibility.

  Research MUST justify the classification for each provider separately.
- **FR-1307 (R4, neutrality)**: Research MUST compare at least two conceptual boundary approaches,
  for example a generic per-task options object or a typed or generic equivalent. The comparison
  MUST show whether each can be described in the core contract without provider-specific
  vocabulary. No approach is selected before R1 to R3 are answered.
- **FR-1308 (R5, WebLLM)**: Research MUST determine:
  - which request-scoped generation options WebLLM has;
  - whether the current adapter already exposes them through template configuration;
  - whether a per-task path would override or conflict with template configuration;
  - whether provider-specific option types would appear in the provider-neutral runtime type.

  WebLLM functionality MUST NOT be added for symmetry alone.
- **FR-1309 (R6, templates)**: Research MUST determine whether task-scoped options only
  parameterize one execution, or whether they effectively mutate, bypass, or dynamically create a
  template. 004's fixed-template, no-cache, no-TTL, and runtime-lifetime ownership rules MUST NOT
  be invalidated.
- **FR-1309a (R7, run/stream)**: If a boundary is justified, research MUST show that it applies
  equally to `run()` and `stream()`. It may differ only where a provider limitation that the
  research documents requires it.

### Decision requirements

- **FR-1310**: The feature MUST end with exactly one recorded outcome and the criterion that
  selected it:
  - **NO_CHANGE**, when any of the following holds:
    - R1 shows no material improvement, or the failure was not reproduced;
    - the workaround is sufficient by FR-1304a;
    - the capability is expressible today (R3 class C);
    - the capability is provider-specific without a coherent provider-neutral form;
    - the cost of a public API exceeds the demonstrated value.
  - **INTERNAL_ONLY**, when a provider adapter needs an internal capability but no public runtime
    API change is justified.
  - **PUBLIC_MINIMAL_EXTENSION**, only when all of the following hold:
    - R1 shows material improvement;
    - the capability cannot be expressed with the current public API for a supported provider;
    - R2 shows the capability is task-scoped;
    - R4 shows a provider-neutral description exists;
    - R5 to R7 show no prior contract is violated.
- **FR-1311**: NO_CHANGE is a complete and valid result. With NO_CHANGE or INTERNAL_ONLY, the public
  API snapshot MUST be unchanged.
- **FR-1312**: If the outcome is PUBLIC_MINIMAL_EXTENSION, the extension MUST be the smallest
  additive one that solves the demonstrated problem.
- **FR-1313**: One supported provider that cannot express the capability today is enough to
  satisfy the "cannot be expressed" condition of FR-1310. The extension MUST still be described
  in provider-neutral terms. For every other public provider, the spec MUST state whether
  task-scoped options are ignored, rejected, or forwarded. No provider gains functionality only
  for symmetry (FR-1308).

### Compatibility and lifecycle requirements (apply only if production code changes)

- **FR-1320**: The following invariants MUST hold, including for tasks that use any new capability:
  1. Invalid task options that can be validated before admission consume no queue entry or slot.
  2. Queued cancellation remains task-local.
  3. Running cancellation remains task-local.
  4. A task start failure keeps the existing classification rules (`broken`, `failed`,
     `cancelled`).
  5. Task cleanup happens exactly once.
  6. The slot is released only after task cleanup settles.
  7. A stream's early return cleans up before iteration exits, and stream admission stays lazy.
  8. `shutdown()` stays idempotent and never rejects.
  9. `snapshot()` stays synchronous and side-effect free.
  10. One task's options never reach another task's provider call.
- **FR-1321**: Callers that do not use the new capability MUST see unchanged behavior. This covers
  `run(input)`, `run(input, { signal })`, `stream(input)`, and `stream(input, { signal })`, each with
  or without `template`.
- **FR-1322**: `Runtime` MUST NOT be redesigned. Existing public contracts MUST stay intact unless a
  concrete incompatibility is identified and justified in the spec.

### Ownership requirement

- **FR-1330**: Any proposed task-scoped object MUST have written ownership semantics that state:
  - whether it is passed by reference or copied;
  - whether AkariSP retains it after the task settles;
  - whether AkariSP mutates it;
  - what happens if the caller mutates it after submission;
  - that it never becomes part of a template or of runtime state.

  Defensive copying MUST NOT be added unless the research shows it is needed.

### Scope exclusions

- **FR-1340**: The feature MUST NOT add any of the following:
  - agent abstractions, tool orchestration, tool-call observation, or tool loops;
  - LangChain or LangGraph integration;
  - provider routing, fallback, or a registry;
  - dynamic templates, template mutation, template caching, LRU, or TTL;
  - runtime identity or creation timestamps;
  - a new telemetry system;
  - framework adapters or helpers;
  - automatic JSON parsing or automatic Markdown fence removal;
  - retry or fallback policy;
  - schema generation or prompt generation;
  - model quality scoring;
  - a generic structured-output framework.
- **FR-1341**: The feature MUST NOT change the following, which are separate findings:
  - error classification: a context overflow surfacing as `TaskError('failed')` with the cause
    preserved;
  - runtime identity metadata;
  - tool-call visibility;
  - native broken-state classification (deferred by the 012 research).
- **FR-1342**: Evidence MUST be labelled as one of documented contract, implementation behavior,
  experimental observation, or hypothesis. Evidence is ranked as follows:
  1. Constitution
  2. Feature specs
  3. Research
  4. Provider contracts
  5. Source
  6. Tests
  7. Real-browser experiment
  8. Inference

  An experimental observation MUST NOT be stated as a permanent provider guarantee.

### Key Entities

- **Comparison attempt**: one prompt in one arm. It records its arm, workload, round, raw output,
  parse outcome, failure category, error name and message, latency, and whether a fallback was
  needed.
- **Arm summary**: counts per failure category, the latency distribution, and the number of
  attempts.
- **Boundary decision**: the chosen outcome, the R3 class per provider, the selecting criterion,
  and the evidence references. For PUBLIC_MINIMAL_EXTENSION it also records the provider-neutral
  capability description and its ownership semantics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-1301**: The controlled comparison has at least 30 measured attempts per arm. Applying
  FR-1304 to it yields exactly one of "material improvement", "no material improvement", or
  "failure not reproduced", and a reviewer can reproduce that answer from the raw records.
- **SC-1302**: Any proposed public abstraction is described in the core contract with 0
  provider-specific terms.
- **SC-1303**: If a public extension ships, 100% of the existing run and stream test scenarios pass
  without modification.
- **SC-1304**: In a test with at least 2 consecutive tasks where only one supplies options, 0
  options reach the other task's provider call.
- **SC-1305**: The existing cancellation, queue, cleanup, snapshot, broken, closed, and shutdown
  tests pass unchanged: all existing tests pass.
- **SC-1306**: When the FR-1310 conditions for an extension are not all met, the feature closes as
  NO_CHANGE with 0 changes to production source and to the public API snapshot.

## Assumptions

- **Numbering**: This feature is numbered 013 as the maintainer requested. Number 012 stays reserved
  for the deferred Prompt API broken-state candidate
  (`experiments/prompt-api-broken-state/`, decision DEFER).
- **Prior contracts**: "Features 001–012" in the input refers to this repository's specs 001–011
  plus the 012 pre-feature research. The consumer application's own feature numbering is separate.
- **Environment**: The real-browser comparison runs in desktop Chrome where the model is already
  available, like the earlier real-browser experiments. If no such environment is available, R1 is
  BLOCKED and no public extension can be chosen.
- **Parsing rule**: The rule is defined once before any measurement, for example strict JSON parse
  of the whole trimmed output followed by a shape check against the constraint. It is not tuned
  after results are seen.
- **Workload**: The workload reflects the consumer's case: a short structured object with an
  identifier field. It avoids financial reasoning, external data, and network APIs.
- **Existing consumer workaround**: The consumer's fence-stripping fallback is the consumer's own
  code. It is evidence for R1 and NO_CHANGE and is not a candidate AkariSP feature.
