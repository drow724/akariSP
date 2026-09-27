# Feature Specification: Framework Compatibility Validation

**Feature Branch**: `010-framework-compatibility-validation`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Determine, with evidence, whether the published `akarisp` package
can be used safely and naturally in representative frontend environments (React + Vite, Vue +
Vite, Svelte + Vite, Next.js) through each framework's ordinary lifecycle primitives, without any
framework-specific AkariSP adapter, hook, composable, store, plugin, or export. Production source
diff ideally 0. The result is evidence plus a per-ecosystem decision (no action / docs only /
candidate future feature), not an adapter."

## Evidence (state at the start of 010)

| Item | Observed (2026-09-27) |
|---|---|
| Published release | `akarisp@0.1.0-alpha.1`; `alpha` and `latest` → `0.1.0-alpha.1` (verified in 009) |
| Entry points | `akarisp` (`createRuntime`, `TaskError`, types) and `akarisp/webllm` (`createWebLLMRuntime`). ESM only, 0 runtime dependencies |
| Server-side import | In a plain server-side JavaScript process with no browser globals, importing both entry points of the registry-installed package succeeds. Importing reads no browser global, which the 005 boundary tests also enforce |
| Server-side creation | `createRuntime()` in the same process rejects with `ReferenceError: LanguageModel is not defined`, not a `TaskError`. The browser provider global is read only when the runtime creates its first session |
| Lifecycle contract (001–007) | Every created runtime must be ended by an explicit `shutdown()`. `shutdown()` is idempotent, never rejects, and resolves only after all task and provider cleanup. `stream()` is lazy; breaking out of it cleans up. `snapshot()` is read-only and synchronous |

The two server-side rows are the first evidence for the Next.js question. Importing the package
on the server is safe. Creating a runtime on the server is not possible, and it fails with a
generic error instead of an AkariSP error.

## Clarifications

### Session 2026-09-27

- Q: How are the observations gathered? → A: Option C, mixed.
  - Automated, repeatable on demand: installation, production builds, and runtime creation and
    shutdown counts across mount/unmount.
  - One guided manual run per environment, recorded as evidence: development-only behaviors
    (React's development double mount, and module replacement on file change).
- Q: Which provider executes tasks in the applications? → A: Option C, both.
  - Automated runs use a scripted stand-in for the browser's `LanguageModel` global, like the 006
    compatibility harness. It lives only in test code, and the public API is unchanged.
  - One manual run per environment uses the real Chrome Prompt API.
- Q: Which Next.js routing model? → A: Option A, App Router only (server components; the
  current default).
- Q: What decides between "existing API sufficient", "documentation sufficient", and "candidate
  future feature"? → A: Option B, a code-pattern rule (see FR-1018).
- Q: Are the four validation applications committed with pinned versions, or generated fresh for
  each run? → A: Option A, committed.
  - Four minimal applications are committed with their `package.json` and lockfile.
  - They pin exact framework and tool versions and the registry `akarisp` version.
  - They are excluded from the offline test run and from the published package.

## User Scenarios & Testing *(mandatory)*

Actors: **frontend developers** adding the published `akarisp` to an existing application;
**the maintainer**, who decides from the evidence whether any future framework integration is
justified.

### User Story 1 - Use AkariSP in a Vite application with React, Vue, or Svelte (Priority: P1)

A developer installs `akarisp` from npm into a React, Vue, or Svelte application built with Vite.
They create a runtime within their component lifecycle, run and stream tasks, and shut the
runtime down when the owning component goes away. All of this uses only the framework's normal
lifecycle primitives and AkariSP's existing API.

**Why this priority**: These three are the most common client-only setups. If ordinary usage
leaks runtimes, duplicates them, or skips cleanup, every user of those frameworks is affected.

**Independent Test**: For each of the three frameworks, a minimal application installed from
the registry passes these checks:
- it starts in development mode;
- it builds for production;
- it mounts and unmounts a component that owns a runtime, several times;
- the recorded runtime creations and shutdowns balance.

**Acceptance Scenarios**:

1. **Given** a fresh application of the framework with `akarisp` installed from the public
   registry, **When** it is started in development mode and built for production, **Then** both
   succeed, and neither step errors because of AkariSP's packaging or browser-only code.
2. **Given** a component that owns a runtime through the framework's ordinary mount and unmount
   primitives, **When** it is mounted, used (one run, one stream), and unmounted, **Then**
   exactly one runtime is created per mount, and each is shut down before or at unmount. Active
   work is cancelled, and no runtime is left in a state other than `closed`.
3. **Given** the framework's development-only behaviors (for example, deliberate double-mount
   checks, or module replacement on file change), **When** they occur, **Then** the observed
   runtime creations and shutdowns are recorded. Any duplicate or leaked runtime is reported as
   a finding, with the pattern that avoids it.
4. **Given** a stream in progress, **When** the owning component unmounts, **Then** the stream
   ends and its cleanup completes under AkariSP's existing semantics.

---

### User Story 2 - Use AkariSP in Next.js across the server/client boundary (Priority: P1)

A developer adds `akarisp` to a Next.js application that uses server rendering and server
components. They must know where the package may be imported, where a runtime may be created,
and what happens if the boundary is crossed by mistake.

**Why this priority**: This is the only target where AkariSP code can also be evaluated on the
server, and it is where browser-native libraries most often break.

**Independent Test**: A minimal Next.js application installed from the registry builds for
production and runs in development and production mode. A client-side page owns a runtime
across navigation away and back. The server-side import and misuse cases are observed and
recorded.

**Acceptance Scenarios**:

1. **Given** a page rendered on the server that contains a client-side component owning a
   runtime, **When** the application is built and served, **Then** the build succeeds, server
   rendering produces no error, and the runtime is created only in the browser.
2. **Given** `akarisp` imported in server-evaluated code, **When** the application is built and
   rendered, **Then** the observed result is recorded as `PASS` or `FAIL` with its error, whether
   or not a runtime is created there.
3. **Given** a runtime creation attempted in server-evaluated code, **When** it runs, **Then** the
   observed failure is recorded as evidence for documentation. Improving it is decided under
   FR-1012, not in this story.
4. **Given** navigation away from the page and back, **When** it happens, **Then** each runtime
   created on the page is shut down when the page is left, and a new one is created on return.

---

### User Story 3 - Decide the next step for each ecosystem from evidence (Priority: P2)

The maintainer reads one result record per environment and a conclusion per ecosystem.
Conclusions are: no action, documentation only, candidate for a future framework feature, or
candidate for a core feature. Each is backed by the recorded observations.

**Why this priority**: The point of the feature is a trustworthy decision. Without it, adapter
packages would be built or refused on opinion.

**Independent Test**: Every environment has a complete result record, and every ecosystem
conclusion cites the observations it rests on.

**Acceptance Scenarios**:

1. **Given** the completed validation, **When** the records are read, **Then** each environment
   records:
   - the tested framework and tool versions, and the tested AkariSP version;
   - install, development, production build, and browser/runtime results;
   - mount/unmount and cleanup behavior;
   - framework-specific observations;
   - a final status.
2. **Given** a failure caused by the platform (for example, no local model available), **When**
   it is recorded, **Then** it is recorded as `BLOCKED` or `SKIPPED` for execution, not as a
   framework incompatibility.
3. **Given** friction that needs non-obvious code in every application, **When** it is concluded,
   **Then** it is recorded as a candidate for a separate future feature, and nothing is built for
   it in this feature.

---

### User Story 4 - Evidence-backed usage documentation (Priority: P3)

A developer finds a short, evidence-backed note for their framework in the AkariSP documentation.
It covers where to create the runtime, who calls `shutdown()`, what development-mode behavior to
expect, and, for Next.js, the client boundary.

**Why this priority**: Documentation is the cheapest fix when the existing API suffices, but it
is only useful after the evidence exists.

**Independent Test**: Every documented pattern corresponds to an application that was validated
with that exact pattern.

**Acceptance Scenarios**:

1. **Given** an ecosystem concluded as "no action" or "documentation only", **When** its
   documentation is read, **Then** each code pattern shown is the one used by a validated
   application.
2. **Given** the documentation, **When** it is compared with the public API, **Then** it uses
   only existing public names and introduces no helper presented as part of AkariSP.

---

### Edge Cases

- **Development double mount**: an intentional development-only double mount creates two
  runtimes briefly. Is the first always shut down? The observation is recorded either way.
- **Module replacement during development**: when the file owning a runtime is replaced, the old
  runtime may be left without an owner. The observation is recorded, and development-only leaks
  are distinguished from production behavior.
- **Unmount during creation**: unmount can happen before `createRuntime` resolves. The late
  runtime must still be shut down by the owner's code; the existing late-creation semantics
  apply.
- **Unmount during a stream**: the stream must end with cleanup.
- **Server evaluation**: a module importing `akarisp` may be evaluated on the server, at build
  time or at request time.
- **Provider unavailable**: in the environment used for testing, the browser provider may be
  absent or its model unavailable. Framework results stay valid, and provider execution is
  marked `BLOCKED`/`SKIPPED`.
- **Private build tooling**: a framework's bundler may try to resolve `akarisp` internals; they
  must stay unreachable (as verified in 009).

## Requirements *(mandatory)*

### Functional Requirements

**Environments and artifact**

- **FR-1001**: Validation MUST cover four environments: React + Vite, Vue + Vite, Svelte + Vite,
  and Next.js. Vite is validated through the first three, not as a separate target.
- **FR-1002**: Each environment MUST depend on the published package, installed from the public
  registry at an explicitly recorded version (initially `0.1.0-alpha.1`). Repository sources,
  local builds, local tarballs, links, and workspaces MUST NOT be used as the primary evidence.
- **FR-1003**: The exact framework, tool, and runtime versions of each environment MUST be
  recorded, and they MUST be reproducible.
  - Each validation application is committed with its `package.json` and lockfile.
  - These pin exact framework and tool versions and the exact registry `akarisp` version.
  - The applications are excluded from the offline test run (FR-1016) and from the published
    package.

  No compatibility guarantee beyond the tested versions is claimed.
- **FR-1004**: Each environment MUST use only AkariSP's public entry points and existing API. No
  framework-specific entry point, export, hook, composable, store, plugin, or wrapper is added to
  AkariSP.

**Per-environment observations**

- **FR-1005**: Each environment MUST record:
  - installation;
  - development-mode start and page load;
  - production build (and, where applicable, production serve);
  - browser execution.

  Each is recorded as `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`, with its reason.
- **FR-1006**: Each environment MUST exercise runtime ownership through the framework's ordinary
  lifecycle primitives:
  - creation on mount and shutdown on unmount;
  - repeated mount/unmount (at least 3 cycles);
  - one `run()`;
  - one `stream()`;
  - cancellation by unmount of an in-progress stream.

  The creation and shutdown counts are recorded and must balance.
  - **Automated**: installation, production builds, and these ownership counts are gathered by
    automated browser runs that can be repeated on demand.
  - **Manual**: development-only behaviors (FR-1007) are gathered by one guided manual run per
    environment, recorded as evidence.
- **FR-1007**: Each environment MUST observe its development-only lifecycle behaviors and record
  their effect on runtime creation and shutdown: React's development double mount, and module
  replacement on file change in all Vite environments and Next.js. A leak or duplicate is a
  finding with its cause and the pattern that avoids it; it is not silently worked around.
- **FR-1008**: The provider used to execute tasks in these applications is chosen only to expose
  application lifecycle. AkariSP has no public way to inject a test provider, so:
  - **Automated runs** use a scripted stand-in for the browser's `LanguageModel` global. It lives
    in test code only, in the same way as the 006 compatibility harness. It MUST NOT be exported
    by or added to AkariSP, and it MUST NOT change the public API.
  - **Manual runs** exercise the real Chrome Prompt API once per environment. Where the model is
    unavailable, execution is `BLOCKED` and framework results still stand.

  Provider limitations are recorded as `BLOCKED`/`SKIPPED`. No provider comparison, registry,
  fallback, or third provider is added.

**Next.js boundary**

- **FR-1009**: The Next.js environment MUST validate:
  - server rendering of a page containing a client-side component that owns a runtime;
  - the production build;
  - runtime creation only in the browser;
  - shutdown when the page is left and re-creation when it is re-entered.

  It covers the App Router only (server components, the current default). The Pages Router is out
  of scope.
- **FR-1010**: The Next.js environment MUST record the observed result of `akarisp` being imported
  by server-evaluated code, and of a runtime creation attempted there.
- **FR-1011**: AkariSP MUST NOT gain a client directive, Next.js-specific export, SSR detection,
  dynamic-import wrapper, or routing logic unless the evidence shows the existing package cannot
  be used correctly with a documented client boundary. Even then, the change is proposed as a
  separate feature.
- **FR-1012**: A server-side runtime creation is observed to fail with a generic
  `ReferenceError`. The feature MUST record whether this makes correct usage harder to diagnose,
  and MUST conclude either "documented" or "candidate core improvement". It MUST NOT change the
  error behavior within this feature.

**Semantics and scope**

- **FR-1013**: AkariSP's established lifecycle semantics (001–007) remain authoritative. A
  framework observation that contradicts them is recorded as a finding, not accommodated by
  changing AkariSP.
- **FR-1014**: Production source changes MUST be 0. A genuine core defect found here is recorded
  with evidence and proposed as a separate feature. A small internal fix is allowed only when it
  stays inside the established contract, adds no API or semantics, and is justified separately.
- **FR-1015**: The validation applications test integration boundaries only. They MUST NOT
  re-test the runtime semantics already covered by the repository's own tests.
- **FR-1016**: The repository's existing offline test run MUST stay unaffected: no network, and
  no framework toolchains required.

**Results and decisions**

- **FR-1017**: Each environment MUST have one result record containing:
  - AkariSP version, framework and tool versions, and date;
  - the FR-1005 statuses;
  - ownership and cleanup observations (FR-1006, FR-1007);
  - framework-specific observations;
  - a final status.
- **FR-1018**: Each ecosystem (React, Vue, Svelte, Next.js) MUST end with exactly one conclusion,
  which cites the observations it rests on.
  - **Existing API sufficient**: the straightforward code using the framework's ordinary
    lifecycle primitives behaves correctly.
  - **Documentation sufficient**: correct usage needs a short, fixed pattern, and that pattern
    can be written with framework primitives and AkariSP's public API alone. Example: also
    shutting down a runtime whose creation resolved after unmount.
  - **Framework-specific friction demonstrated** (candidate future feature): the required
    pattern depends on AkariSP internals, or AkariSP's lifecycle contract cannot be kept with
    framework primitives alone.
  - **Core defect demonstrated** (candidate core feature): AkariSP violates its own established
    contract.
- **FR-1019**: Where the conclusion is "existing API sufficient" or "documentation sufficient",
  the documentation MUST gain a short section per framework. It shows only patterns used by a
  validated application, and names only existing public API.

### Key Entities

- **Environment**: one validated application (React + Vite, Vue + Vite, Svelte + Vite, Next.js).
  It has pinned framework and tool versions and the published AkariSP version.
- **Result record**: per environment, the statuses, ownership and cleanup counts, observations,
  and the final status.
- **Ownership observation**: runtimes created versus shut down across mount/unmount, development
  behaviors, and navigation.
- **Ecosystem conclusion**: one of four outcomes, with cited evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-1001**: 4/4 environments have a complete result record, with recorded versions and the
  published AkariSP version.
- **SC-1002**: In each environment where execution is not `BLOCKED`, runtime creations equal
  shutdowns after at least 3 mount/unmount cycles. Every runtime ends in `closed`, and a stream
  interrupted by unmount completes its cleanup.
- **SC-1003**: 4/4 production builds complete, or each failure is recorded with its cause and
  classified as an AkariSP or non-AkariSP problem.
- **SC-1004**: In Next.js, a server-rendered page containing a runtime-owning client component
  renders without a server error, and 0 runtimes are created on the server.
- **SC-1005**: 4/4 ecosystems have exactly one conclusion with cited evidence.
- **SC-1006**: 0 framework-specific APIs, entry points, or packages are added. The production
  source diff is 0, or each change is individually justified under FR-1014.
- **SC-1007**: Every documented pattern corresponds to a validated application, and the
  documentation names 0 non-existent APIs.

## Assumptions

- **Versions**: current stable releases of each framework and tool on 2026-09-27 are used and
  recorded. Version choice is a plan decision.
- **Next.js routing**: the App Router only (clarified); Pages Router applications are not
  validated.
- **Browsers**: execution runs in a desktop browser (Chrome). Other browsers were covered by 006
  and are not repeated here.
- **Downloads**: installing framework toolchains and the published package from the public
  registry requires network access and user approval. No model download happens without the
  user's permission.
- **Fixture code**: the validation applications may duplicate setup code across frameworks.
  Shared test utilities are allowed only if they do not become product architecture.
- **Non-goals, unchanged from the input**:
  - no framework packages, hooks, composables, stores, or plugins;
  - no Next.js-specific APIs;
  - no adapter SPI or registry, automatic detection, singleton, or global runtime registry;
  - no framework branches in core;
  - no provider registry, routing, fallback, or third provider;
  - no monorepo, workspaces, or package split;
  - no agent, workflow, RAG, telemetry, or plugin systems.
