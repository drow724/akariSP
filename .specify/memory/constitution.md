<!--
Sync Impact Report
- Version change: (template, unversioned) → 1.0.0
- Modified principles: none (initial ratification)
- Added principles:
  I. Small Core; II. Browser Native First; III. Benchmark Driven; IV. Minimal Overhead;
  V. Explicit Lifecycle; VI. Context Safety; VII. Framework Agnostic;
  VIII. Provider Extensibility Without Premature Abstraction;
  IX. Native Features Before Reinvention; X. Scope Discipline;
  XI. Reliability Over Feature Count; XII. Public API Stability
- Added sections: Scope & Technical Constraints; Development Workflow & Quality Gates; Governance
- Removed sections: none
- Templates: not modified (dependent templates read the constitution at runtime)
- Deferred TODOs: none
-->

# AkariSP Constitution

AkariSP is a lightweight, high-performance runtime for managing browser-native LLM sessions.

## Core Principles

### I. Small Core

The core MUST remain narrowly focused on session lifecycle, resource scheduling, concurrency,
queueing, and observability. The core MUST NOT become an agent framework: no planning loops,
tool orchestration, memory stores, or prompt-chaining abstractions belong in it.

**Rationale**: A narrow core stays fast, auditable, and reusable by any higher-level framework.

### II. Browser Native First

Features MUST prefer native browser AI capabilities (e.g., the Prompt API) before introducing
external runtimes, WASM model engines, or third-party dependencies. Any non-native runtime or
dependency MUST be justified in the plan by a concrete gap the native capability cannot fill.

**Rationale**: Native capabilities avoid download cost, duplicated models, and extra attack surface.

### III. Benchmark Driven

Performance optimizations MUST be justified by reproducible benchmarks. Any claim about latency,
throughput, or memory MUST be backed by measured data, with the benchmark procedure, environment
(browser, version, hardware), and raw results recorded so others can rerun it.

**Rationale**: Unmeasured optimizations add complexity without verified benefit.

### IV. Minimal Overhead

AkariSP itself MUST introduce minimal runtime overhead relative to calling the underlying provider
directly. Abstractions MUST NOT be added unless they solve a demonstrated problem. Overhead-sensitive
paths (acquire, release, enqueue, dispatch) SHOULD have a benchmark measuring AkariSP's added cost.

**Rationale**: A session runtime that is slower than the thing it manages defeats its purpose.

### V. Explicit Lifecycle

Session creation, cloning, acquisition, release, destruction, timeout, and cancellation MUST have
clear, documented ownership and lifecycle rules. Every session MUST have exactly one owner at any
time; every acquired resource MUST have a deterministic release path, including on error, timeout,
and abort.

**Rationale**: Leaked or double-owned sessions waste scarce on-device model resources.

### VI. Context Safety

Task sessions containing mutated conversational context MUST NOT be silently reused across
unrelated tasks. Reuse of a session with prior context MUST be an explicit caller decision;
otherwise the runtime MUST provide a clean session (fresh or cloned from a pristine base).

**Rationale**: Silent context leakage produces incorrect outputs and can leak data between tasks.

### VII. Framework Agnostic

The core MUST NOT depend on React, Vue, LangChain, LangGraph, or any other application framework.
The core MUST be usable from plain JavaScript/TypeScript in a browser context.

**Rationale**: Framework coupling limits adoption and drags framework churn into the core.

### VIII. Provider Extensibility Without Premature Abstraction

The architecture SHOULD permit additional browser LLM providers. A provider abstraction layer MUST
NOT be implemented until justified by at least one concrete second provider or a clearly defined
API boundary. Until then, provider-specific code SHOULD stay localized so extraction is cheap later.

**Rationale**: Abstractions designed from a single implementation usually encode the wrong seams.

### IX. Native Features Before Reinvention

Browser platform primitives and existing standard APIs (e.g., `AbortController`/`AbortSignal`,
`Promise`, `EventTarget`, `performance`, `queueMicrotask`) MUST be used whenever they solve the
problem reliably. Custom equivalents MUST be justified by a documented deficiency.

**Rationale**: Standard primitives are familiar, interoperable, and maintained by the platform.

### X. Scope Discipline

React adapters, Vue adapters, LangChain integrations, TradingAgents, and Pixel Office visualization
are consumers/integrations and MUST remain outside the core. They MAY live in separate packages
that depend on the core; the core MUST NOT depend on them.

**Rationale**: Keeping integrations outside the core preserves Principles I and VII.

### XI. Reliability Over Feature Count

Backpressure, cancellation, deterministic cleanup, and useful metrics MUST take priority over
convenience features. A convenience feature MUST NOT ship while a known reliability defect in the
same area remains open.

**Rationale**: A runtime is trusted for what it guarantees, not for how much it offers.

### XII. Public API Stability

The public surface MUST be kept small. Internal scheduler, queue, or provider implementation details
MUST NOT be exposed without demonstrated user need. Breaking changes to the public API MUST follow
semantic versioning and be documented with a migration note.

**Rationale**: Every exported symbol is a long-term maintenance commitment.

## Scope & Technical Constraints

- **In scope for the core**: session lifecycle, resource scheduling, concurrency limits, queueing
  and backpressure, cancellation and timeouts, and observability (metrics/events).
- **Out of scope for the core**: agent frameworks, UI framework adapters, LLM orchestration
  libraries, application-specific consumers, and visualization.
- **Dependencies**: runtime dependencies in the core MUST be justified individually against
  Principles II, IV, and IX.
- **Observability**: metrics exposed by the core MUST be useful for diagnosing queueing, saturation,
  and lifecycle problems, and MUST NOT impose measurable overhead when unused.

## Development Workflow & Quality Gates

- Every plan MUST include a Constitution Check that evaluates the design against all principles and
  justifies any exception in a complexity-tracking entry.
- Changes claiming performance improvements MUST include benchmark results (Principle III).
- Changes touching lifecycle, cancellation, or cleanup MUST include tests covering error, timeout,
  and abort paths (Principles V and XI).
- Changes adding or altering public API MUST state the demonstrated user need (Principle XII).
- Reviews MUST reject new abstractions, dependencies, or integrations in the core that lack the
  justification required by Principles IV, VIII, and X.

## Governance

This constitution supersedes other project practices. Where guidance conflicts, this document wins.

- **Amendments**: proposed via a documented change to this file, including rationale and the
  impact on existing specs, plans, and code. Amendments take effect once merged.
- **Versioning**: semantic versioning. MAJOR for backward-incompatible removal or redefinition of a
  principle; MINOR for a new principle/section or materially expanded guidance; PATCH for
  clarifications and wording fixes.
- **Compliance**: all plans and reviews MUST verify compliance with these principles. Unjustified
  complexity is grounds for rejection. Compliance SHOULD be re-evaluated whenever the core's scope,
  dependencies, or public API change.

**Version**: 1.0.0 | **Ratified**: 2026-09-26 | **Last Amended**: 2026-09-26
