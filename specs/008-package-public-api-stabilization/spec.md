# Feature Specification: Package and Public API Stabilization

**Feature Branch**: `008-package-public-api-stabilization`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Before the first npm publish, decide what the single `akarisp`
package ships, what is importable, what is promised as public API, and what stays internal.
Packaging / exports / public API stabilization only: no new runtime features, no core redesign,
no provider registry, no package split, runtime dependencies stay 0. Validate against the real
packed tarball, an external consumer, and the existing real-browser lifecycle checks."

## Baseline (state at the start of 008)

Measured on `main` after 007 was merged:

| Item | Current state |
|---|---|
| Package name / version | `akarisp` / `0.1.0`, unscoped, `"type": "module"` |
| Export map | only `"."` → compiled root entry and its declarations |
| Shipped files | `files: ["dist"]`; the build emits `dist/core`, `dist/browser`, `dist/webllm` next to the root entry |
| Root exports (8) | `createRuntime`, `TaskError` (values); `RuntimeOptions`, `Runtime`, `RuntimeSnapshot`, `TaskStream`, `TaskResult`, `TaskTiming` (types) |
| WebLLM integration | internal module with `createWebLLMRuntime(engine, options)` and a structural engine type; not in the export map |
| Provider contract | internal (`SessionProvider<B>`, `Session`, `createCoreRuntime`); not exported |
| Runtime dependencies | 0 (dev: TypeScript, Playwright) |
| `engines` field | `node >= 22.18` (a development requirement, currently published) |
| Metadata | `LICENSE` file exists; `package.json` has no `license` or `repository` field |
| Validation | Node tests 135/135, TypeScript, build, Playwright 21/21, Chrome 152 lifecycle 7/7, WebLLM 0.2.85 lifecycle 9/9 |

Known review inputs (to be decided, not pre-decided here):

- Root documentation and doc comments still describe some behavior in Chrome terms (for example
  "clone", "`InvalidStateError`", "passed to `LanguageModel.create()`"), although the root entry
  is Chrome-specific only in `createRuntime`.
- `run()` / `stream()` options are an inline type with no exported name.
- `RuntimeSnapshot` fields are not marked read-only, while `Runtime.state` is.

## Clarifications

### Session 2026-09-27

- Q: Is WebLLM a public entry point in the first release? → A: Option A. `akarisp/webllm` is an
  official subpath export of the same package. Its public surface is limited to the minimum
  needed for real use; the generic provider contract stays internal.
- Q: First release version and dist-tag? → A: Option A. `0.1.0-alpha.0` on the `alpha` tag. The
  first release is the real-consumer validation stage of the freeze candidate.
- Q: README framing? → A: Option A. Chrome Prompt API quick start first; WebLLM in its own
  official section; the provider-neutral internal architecture is not the README entry point.

## User Scenarios & Testing *(mandatory)*

Actors: **application developers** installing `akarisp` from npm for the first time;
**AkariSP maintainers** who must decide what they promise long-term before the first publish.

### User Story 1 - Install and use the Chrome Prompt API runtime from the published package (Priority: P1)

A developer runs `npm install akarisp`, imports `createRuntime` from `akarisp`, and gets working
code and correct type information without knowing the repository layout.

**Why this priority**: This is the primary product; nothing else matters if the packed artifact
does not install, type-check, and import correctly.

**Independent Test**: Pack the package, install the tarball into a fresh consumer project that
has no access to the repository sources, type-check a file that uses the root API, and import it
at runtime.

**Acceptance Scenarios**:

1. **Given** the packed tarball, **When** a fresh consumer installs it and imports `createRuntime`
   and `TaskError` from `akarisp`, **Then** the import succeeds at runtime and type-checking
   passes with the documented usage (run, stream, snapshot, shutdown, template, error codes).
2. **Given** the same consumer, **When** it imports any internal path (`akarisp/core`,
   `akarisp/browser`, `akarisp/internal`, `akarisp/dist/...`, `akarisp/src/...`), **Then** the
   import fails, even though some of those files exist inside the package.
3. **Given** the installed package, **When** its dependency tree is inspected, **Then** it adds
   zero runtime dependencies.

---

### User Story 2 - Maintainers freeze a reviewed, minimal public surface (Priority: P1)

Every exported name, type, field, option, and error code has been reviewed and given one decision
(keep, rename, hide, or change before first publish), with a reason tied to Chrome + WebLLM
evidence. The resulting surface is recorded as a checkable snapshot, so any later accidental
change to exports or public types fails a check.

**Why this priority**: After the first publish, every public name is a semver commitment
(Constitution XII). This is the last point where changes are free.

**Independent Test**: The review table covers 100% of the items in the current public surface;
changing, adding, or removing any public export or public type member in the build makes the
snapshot check fail.

**Acceptance Scenarios**:

1. **Given** the current public surface, **When** the review is complete, **Then** each item has
   exactly one recorded decision and a reason; no item is kept only because it already exists,
   and none is changed without a concrete problem.
2. **Given** the frozen snapshot, **When** a public export or type member is added, removed, or
   changed without updating the snapshot, **Then** the check fails.
3. **Given** the root public API, **When** it is read by a developer, **Then** it contains no
   provider-specific vocabulary beyond what the Chrome entry point (`createRuntime`) itself needs.

---

### User Story 3 - Use the WebLLM integration from the same package (Priority: P2)

A developer who already creates and loads a WebLLM engine in their application passes it to
AkariSP from the same `akarisp` package and gets the same run / stream / snapshot / shutdown
behavior, with the ownership and limit rules stated up front.

**Why this priority**: 007 proved the lifecycle; this story turns that proof into a public
promise. It is independent of User Story 1, which remains usable without it.

**Independent Test**: A fresh consumer imports `akarisp/webllm` from the packed tarball and
type-checks it without installing WebLLM itself.

**Acceptance Scenarios**:

1. **Given** the published `akarisp/webllm` entry point, **When** a consumer imports it without `@mlc-ai/web-llm` installed, **Then**
   import and type-checking succeed, and the engine is accepted structurally (a real WebLLM
   engine type-checks against it).
2. **Given** a runtime created from an application-created engine, **When** the documentation is
   read, **Then** it states: the application creates and loads the engine; after successful
   runtime creation the runtime uses the engine exclusively and unloads it at shutdown; if
   creation fails the engine is untouched; `limit` must be 1.
3. **Given** the real WebLLM lifecycle checks, **When** they run against the build after the
   packaging changes, **Then** all 9 pass as in 007.

---

### User Story 4 - The packed artifact contains exactly what users need (Priority: P2)

The tarball is treated as the product: its file list, size, declarations, and metadata are
inspected before publish.

**Why this priority**: Accidentally publishing specs, experiments, tests, smoke pages, or
development metadata is permanent once released.

**Independent Test**: Pack the package and compare its file list against an explicit allow-list.

**Acceptance Scenarios**:

1. **Given** `npm pack`, **When** the file list is inspected, **Then** it contains only compiled
   entry points and modules they load, their declarations, the README, the license, and package
   metadata; no `specs/`, `experiments/`, `test/`, `e2e/`, `smoke/`, `bench/`, `src/` (unless a
   deliberate source-map decision includes it), or config files.
2. **Given** the tarball, **When** every published entry point is checked, **Then** each has its
   declaration file and every declaration it references is present.
3. **Given** the package metadata, **When** it is read, **Then** it has the fields npm users rely
   on (name, version, description, license, repository, entry points) and no development-only
   requirement that would warn or block browser/bundler consumers.

---

### User Story 5 - A first-time user can start from the README alone (Priority: P3)

The README matches the actual package surface: install, root import, lifecycle, options, errors,
and the WebLLM entry point with its constraints.

**Why this priority**: Documentation errors are cheaper to fix than API errors, but the first
impression depends on them.

**Independent Test**: Every import, option, and error code named in the README exists in the
public snapshot, and every public export is documented.

**Acceptance Scenarios**:

1. **Given** the README, **When** its code samples are compiled against the packed package,
   **Then** they type-check.
2. **Given** the README, **When** it describes behavior, **Then** provider-specific wording is
   confined to the section of that provider.

---

### Edge Cases

- A consumer uses a bundler, TypeScript `moduleResolution` `bundler`, or `node16`/`nodenext`:
  the root and any published subpath must resolve in each of these.
- A consumer uses CommonJS `require('akarisp')`: the package is ESM-only. The consumer test
  checks the actual `require()` behavior on the supported development Node, and the
  documentation states exactly what was observed. The test does not assume the call fails.
- A declaration file for a public entry point references an internal module's declarations:
  they must ship, but must not become importable paths.
- The WebLLM entry point is imported by a consumer that never installs WebLLM: it must not pull
  in or require WebLLM at import time.
- A developer passes WebLLM-specific options to `createRuntime` (Chrome) or Chrome-only
  expectations to the WebLLM entry point: behavior follows the existing validation; no new
  cross-provider detection is added.
- `npm pack` is run without a fresh build: the check must fail or build first, never ship stale
  output.
- The published `engines` field states a Node version that is only a development requirement:
  consumers must not receive a misleading install warning.

## Requirements *(mandatory)*

### Functional Requirements

**Package identity and boundary**

- **FR-801**: The package MUST be published as the single unscoped package `akarisp`; no scoped or
  split packages are created.
- **FR-802**: The package MUST declare an explicit export map. Only the root entry point and the
  entry points decided in this feature are importable; every other path, including paths to files
  that physically exist in the package, MUST fail to import.
- **FR-803**: The root entry point MUST provide the Chrome Prompt API runtime (`createRuntime`)
  and the provider-neutral public types and error class.
- **FR-804**: The WebLLM integration MUST be published as the `akarisp/webllm` subpath entry point
  of the same package, exporting only the minimum needed for real use. It MUST accept an application-created engine through a structural type, MUST NOT
  require WebLLM as a dependency, and MUST NOT start any model download.

**Public API review**

- **FR-805**: Every item of the current public surface (all root exports; `Runtime` members;
  `run`/`stream` options; `RuntimeOptions` fields; `RuntimeSnapshot`, `TaskStream`,
  `TaskResult`, `TaskTiming` fields; `TaskError` and every error code; template options; and the
  `akarisp/webllm` entry point) MUST be inventoried with exactly one decision (keep, rename, hide,
  change) and a reason.
- **FR-806**: Each review decision MUST check naming, provider leakage, over/under-specificity,
  necessity, read-only-ness, optional/default semantics, documentable error semantics, and
  robustness against the two evidenced providers. Changes MUST be justified by a concrete problem
  found in that check; changes for speculative future providers MUST NOT be made.
- **FR-807**: The internal provider contract (`SessionProvider`, `Session`, `createCoreRuntime`)
  MUST stay internal in the first release unless a concrete user need is demonstrated; no public
  registry, provider factory, capability, or strategy API is added.
- **FR-808**: Public API changes decided in the review MUST NOT alter lifecycle semantics proven
  in 001–007 (queue, limit, cancellation, timeout, streaming laziness and early termination,
  broken state, deterministic shutdown, snapshot, templates, Chrome native clone, WebLLM
  interrupt + drain and unload ownership).

**Artifact**

- **FR-809**: The packed tarball MUST contain only the allow-listed files (User Story 4, scenario 1) and MUST
  include declarations for every public entry point and everything they reference.
- **FR-810**: The package MUST keep zero runtime dependencies. Any optional/peer declaration for
  WebLLM MUST be justified in the plan; adding WebLLM as a dependency is not allowed.
- **FR-811**: Package metadata MUST be publish-ready (name, version, description, license,
  repository, keywords/entry points as needed) and MUST NOT publish development-only constraints
  that mislead consumers.
- **FR-812**: The module format decision (ESM-only or additional CommonJS) MUST be recorded with
  its reason, and the chosen behavior MUST be verified by the consumer test.
- **FR-813**: The package version MUST be `0.1.0-alpha.0`, and the documented publish command MUST
  use the `alpha` dist-tag, so a plain `npm install akarisp` does not select it. No release
  automation is added.

**Verification**

- **FR-814**: A consumer test MUST install only the packed tarball into a project outside the
  repository sources, and MUST verify: runtime import of every public entry point, TypeScript
  declaration resolution for them under the supported resolution modes, and failure of internal
  imports.
- **FR-815**: A public API snapshot MUST be committed and checked automatically, so a change in
  exported names or public type shapes fails the check until the snapshot is intentionally
  updated. The smallest mechanism that achieves this MUST be used; a large API-extraction
  framework MUST NOT be added unless the plan shows the smaller one cannot work.
- **FR-816**: Existing Node tests, TypeScript, build, and Playwright MUST pass; existing test
  assertions MUST NOT be weakened (a test may change only where an intentional, reviewed public
  API change requires it, and each such change MUST be listed).
- **FR-817**: The real Chrome Prompt API lifecycle checks (7) and the real WebLLM lifecycle checks
  (9) MUST pass against the post-packaging build, recorded as dated evidence.

**Documentation**

- **FR-818**: The README MUST match the public snapshot: every public entry point and export is
  documented, every documented import and option exists, and provider-specific wording stays in
  that provider's section. The README MUST open with the Chrome Prompt API quick start, describe WebLLM in
  its own official section, and MUST NOT use the provider-neutral internal architecture as its
  entry point.
- **FR-819**: The WebLLM documentation MUST state the application's responsibility
  for creating and loading the engine, the ownership transfer on successful runtime creation, the
  untouched engine on failed creation, `limit` = 1, unload at shutdown, and the WebLLM version the
  behavior was validated against.

### Key Entities

- **Public surface**: the set of importable entry points, the names each exports, and the shapes
  of every exported type; the unit that the snapshot freezes.
- **Entry point**: an importable package path (root; possibly a WebLLM subpath) with its runtime
  module and declarations.
- **Review decision**: per public item, one of keep / rename / hide / change, with reason and
  evidence.
- **Packed artifact**: the tarball produced for publishing; its file list, size, and metadata are
  the source of truth for what users receive.
- **Consumer fixture**: a minimal project outside the repository sources that installs only the
  packed artifact.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-801**: A fresh consumer installs the packed artifact and uses the root API and the
  `akarisp/webllm` API with 0 type errors and 0 runtime import errors.
- **SC-802**: 100% of internal paths tried by the consumer test fail to import; 100% of public
  entry points succeed.
- **SC-803**: 100% of public surface items have a recorded review decision with a reason.
- **SC-804**: The packed artifact contains 0 files outside the allow-list and adds 0 runtime
  dependencies; its file count and size are recorded.
- **SC-805**: Any single change to an exported name or public type member makes the snapshot check
  fail (demonstrated at least once by a deliberate mutation).
- **SC-806**: All existing automated checks pass with 0 weakened assertions; real-browser checks
  pass 7/7 (Chrome) and 9/9 (WebLLM) after the packaging changes.
- **SC-807**: Every import, option, and error code in the README exists in the public snapshot,
  and every public export appears in the README.
- **SC-808**: The number of public exports after review is equal to or smaller than before,
  unless each addition has a recorded demonstrated user need.

## Assumptions

- The package name `akarisp` is available on npm; checking or reserving it is a pre-publish step,
  not part of this feature's automated checks.
- Actual publishing (`npm publish`) is out of scope; 008 ends at publish readiness.
- Before the first publish (tag `alpha`), the freeze candidate may still change based on
  real-consumer feedback; the snapshot records every such change.
- The consumer test may run offline against the local tarball; it must not download models.
- Supported consumer environments are modern browsers via bundlers or native ESM, and TypeScript
  consumers using current resolution modes; Node is a development/test environment, not a
  supported runtime for the library itself.
- The license already chosen for the repository is the package license.
- The WebLLM validation continues to target `@mlc-ai/web-llm` 0.2.85 and the 007 model; other
  WebLLM versions are documented as unverified rather than tested.
- Non-goals from the input apply unchanged: no new runtime features, provider registry, dynamic
  registration, automatic selection or fallback, capability framework, scheduling changes, model
  download manager, package split, framework integrations, monorepo migration, agent/RAG/telemetry
  features, release automation, or plugin system.
