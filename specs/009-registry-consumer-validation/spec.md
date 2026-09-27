# Feature Specification: Registry Consumer Validation

**Feature Branch**: `009-registry-consumer-validation`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Validate that the actual npm-published AkariSP package behaves as
the intended public product for a clean external consumer that installs from the npm registry,
and correct documentation and release-contract discrepancies discovered after the first
publication. Complements, does not duplicate, feature 008's local packed-artifact validation.
Production runtime diff ideally 0. No release-management framework, no permanent dist-tag
policy freeze."

## Evidence (state at the start of 009)

Read from the public npm registry on 2026-09-27:

| Item | Observed |
|---|---|
| Name / versions | `akarisp`; exactly one version, `0.1.0-alpha.0`, published 2026-09-27T07:31:38Z |
| Dist-tags | `alpha` → `0.1.0-alpha.0`, `latest` → `0.1.0-alpha.0` |
| Exports | `"."` and `"./webllm"`, each with `types` and `default` |
| Runtime dependencies | none |
| Artifact | 13 files, 41,694 B unpacked (equal to 008's final package audit) |

Release-process evidence:

- **Expected vs. observed tags.** The expected state before the first publication was
  `alpha` → `0.1.0-alpha.0` with `latest` absent. The observed state has `latest` as well.
  - A plain `npm install akarisp` and `npm install akarisp@alpha` therefore both install
    `0.1.0-alpha.0` today.
- **The mechanism is not established.**
  - The exact command used for the first publication was not recorded, and its CLI log is no
    longer available.
  - The npm CLI documentation says a non-`latest` publish tag does not update `latest`.
  - The registry metadata documentation says every package has a `latest` tag.
- **The configured default tag was not applied.** With npm 10.9.2, a dry-run of `npm publish`
  without a flag announced tag `latest`, although the package declares `alpha` as its default
  publish tag. `npm publish --tag alpha` announced `alpha`. So the configured default publish
  tag was not applied by this CLI version in this repository, observed on 2026-09-27.
- **A later publish attempt was rejected.** It tried to republish `0.1.0-alpha.0` and the
  registry refused with 403 ("cannot publish over the previously published versions"). The
  registry state did not change.
- **Documentation status.**
  - The repository README install text was corrected after publication (merged in PR #10).
    It now states that both tags point at the alpha.
  - The README's Release section still says the publish uses the configured `alpha` tag. The
    dry-run contradicts that.
  - The 008 research record attributes the `latest` tag to registry behavior, which is not
    established.
  - The README shown on the npm package page is the one inside the published artifact. It
    still says a plain install selects nothing until a stable release. It can change only
    through a new publication.

## Clarifications

### Session 2026-09-27

- Q: How is the stale README on the npm package page handled? → A: Option A. 009 publishes a
  documentation/metadata correction release, `0.1.0-alpha.1`, through the full explicit
  procedure: written intent (including where `latest` points), a publish command that names the
  tag, and a post-publish registry check. It is the first release verified against an explicit
  release contract, not one that happens to come out right.
- Q: What happens to the configured default publish tag that was observed not to be applied? →
  A: Option A. Remove it from the package metadata. The procedure always names the tag
  explicitly.
- Q: How is a post-publish mismatch between the registry state and the release intent
  corrected? → A: Option A, fix forward.
  - A dist-tag mismatch is corrected with an explicit dist-tag command and re-checked.
  - An artifact-content defect is corrected by publishing the next version. The release is
    never unpublished.
  - Every mismatch and correction is recorded.
- Q: When is a post-publish check judged a failure, given that registry reads can briefly
  return stale metadata? → A: Option A, bounded re-check.
  - The check re-reads within a fixed waiting window.
  - It is judged a mismatch only if the difference persists past that window.
  - The time of each read and the number of attempts are recorded.
  - The window length is set in the plan.

## User Scenarios & Testing *(mandatory)*

Actors: **application developers** who install AkariSP from npm; **the maintainer** who
publishes releases and must know that what npm serves matches the intent.

### User Story 1 - The package installed from npm is the documented product (Priority: P1)

A developer in a fresh project, with no access to the AkariSP repository, installs `akarisp` from
the npm registry. The public imports work, the internal paths do not, types resolve, and nothing
else is pulled in.

**Why this priority**: Feature 008 proved the artifact before it crossed the registry. After
publication, the registry artifact is the product. Only a registry install proves what users
actually receive.

**Independent Test**: In an empty directory outside the repository, install from the public
registry, then run the import and type checks. No repository file, local tarball, link, or
workspace is involved.

**Acceptance Scenarios**:

1. **Given** a clean consumer, **When** it installs `akarisp` with no tag and, separately, with
   the `alpha` tag, **Then** each install resolves to the version the current release intent
   names for that tag (today both `0.1.0-alpha.0`), and the installed version is recorded.
2. **Given** the registry-installed package, **When** the consumer imports `createRuntime` and
   `TaskError` from `akarisp` and `createWebLLMRuntime` from `akarisp/webllm`, **Then** each
   import succeeds at runtime and type-checks.
3. **Given** the registry-installed package, **When** the consumer imports `akarisp/core`,
   `akarisp/browser`, any `akarisp/src/...` path, or `akarisp/package.json`, **Then** each import
   fails both at runtime and in type-checking.
4. **Given** the registry-installed package, **When** its declarations are resolved under the
   `bundler`, `node16`, and `nodenext` module-resolution modes, **Then** all three succeed for
   AkariSP's own declarations.
5. **Given** the installed dependency tree, **When** it is inspected, **Then** AkariSP adds zero
   runtime dependencies.

---

### User Story 2 - Registry metadata matches the release intent (Priority: P1)

The maintainer compares the registry's metadata for the published version against an explicit,
written statement of what that release was supposed to be: name, version, dist-tags, runtime
dependencies, and entry points.

**Why this priority**: The first publication showed that intent and outcome can differ
(`latest` appeared). Without an explicit intent and a comparison, such a difference is found
only by accident.

**Independent Test**: Read the registry metadata for the published version and compare it
field by field with the recorded release intent. Every field matches, or the difference is
reported.

**Acceptance Scenarios**:

1. **Given** the recorded intent for `0.1.0-alpha.0`, **When** the registry metadata is read,
   **Then** name, version, both dist-tags, runtime dependencies, and the two entry points are
   compared, and each result is recorded as matching or differing.
2. **Given** a difference between intent and registry state, **When** the check runs, **Then**
   it reports the specific field, the expected value, and the observed value. The difference is
   never silently accepted.
3. **Given** the registry exposes other metadata, **When** the check runs, **Then** it compares
   only fields that belong to AkariSP's package contract.

---

### User Story 3 - Every future release states its intent and verifies the result (Priority: P2)

Before publishing, the maintainer writes down the intended dist-tag state for the release. After
publishing, the maintainer runs the same registry comparison and records the outcome.

**Why this priority**: This prevents a repeat of the first-publication surprise. It is
secondary to validating the release that exists today.

**Independent Test**: For a release, the intended tag state exists before publication, and a
recorded comparison exists after it.

**Acceptance Scenarios**:

1. **Given** a planned release, **When** the maintainer prepares it, **Then** the intended
   version and dist-tag targets are written down before the publish command runs, and the
   documented publish procedure names the tag explicitly rather than relying on an implicit
   default.
2. **Given** a completed publication, **When** the maintainer runs the post-publish check,
   **Then** the actual registry state is compared with that intent and the result is recorded.
3. **Given** the intended state is that `latest` should also point at the new alpha, **When**
   publication alone does not achieve that, **Then** the procedure states the explicit follow-up
   step and the check confirms the final state.

---

### User Story 4 - Documentation describes what npm actually does (Priority: P2)

A developer reading the README or the release notes gets installation and release statements
that match the registry. Observed behavior is labeled as observed, not presented as a universal
npm rule.

**Why this priority**: Two statements are currently inaccurate or unproven: the Release
section's reliance on the configured default tag, and the attribution of `latest`.

**Independent Test**: Every installation and release statement in the README and in the 008
and 009 records can be traced to registry evidence or to npm documentation, and none
contradicts the registry state.

**Acceptance Scenarios**:

1. **Given** the README, **When** it describes installation, **Then** it states the current tag
   state (both `alpha` and `latest` → `0.1.0-alpha.0`) as the current release state, not as a
   permanent guarantee.
2. **Given** the README Release section, **When** it describes publishing, **Then** it does not
   claim the configured default tag is applied, and it gives the explicit-tag procedure plus the
   post-publish check.
3. **Given** the 008 research record, **When** it explains the `latest` tag, **Then** it states
   that the mechanism is undetermined: registry behavior and the CLI default are both
   consistent with the evidence. It also records the configured-default-tag observation.
4. **Given** the npm package page after `0.1.0-alpha.1` is published, **When** it is read,
   **Then** it shows the corrected README (FR-915).

---

### Edge Cases

- **Registry or network unavailable.** The registry validation reports that it could not run
  (not a pass), and the repository's offline test suite stays unaffected.
- **Tags move later.** A new version is published, or the maintainer moves a tag after this
  feature. The expected values come from the recorded release intent, not from constants that
  silently go stale; a mismatch is reported.
- **Local npm cache or global configuration.** A cached copy, a user-level npm configuration,
  or a custom registry could serve something other than the public registry. The validation
  must install from the public registry into an isolated consumer and record the registry it
  used.
- **Local build differs from the registry.** The repository's current build may differ from
  the published artifact, for example after a README change. The registry validation must never
  fall back to local output, and differences are expected, not errors.
- **npm package page README.** It cannot be changed without a new publication (FR-915).
- **Registry propagation delay**: right after a publish or dist-tag command, reads may still
  return the previous state. Handled by FR-921's bounded re-check, not by an immediate
  mismatch.
- **Post-publish mismatch** (for example, `latest` not moved, or wrong content in the
  artifact): fix forward per FR-920. Never unpublish, because an unpublished version number
  cannot be reused and existing installs would break.
- **Republishing an existing version.** The registry rejects it (observed 403). The documented
  procedure must bump the version first.

## Requirements *(mandatory)*

### Functional Requirements

**Registry installation**

- **FR-901**: Validation MUST install AkariSP only from the public npm registry into a clean
  consumer outside the repository. Packing, local tarballs, repository self-reference,
  workspaces, `file:` specifiers, and linking MUST NOT be used.
- **FR-902**: Validation MUST install both the untagged package name and the `alpha` tag, and
  MUST record the version each resolved to.
- **FR-903**: Validation MUST confirm the installed artifact adds zero runtime dependencies.

**Public contract from the registry artifact**

- **FR-904**: From the registry-installed consumer, the public imports (`createRuntime`,
  `TaskError` from `akarisp`; `createWebLLMRuntime` from `akarisp/webllm`) MUST succeed at
  runtime and type-check.
- **FR-905**: From the registry-installed consumer, `akarisp/core`, `akarisp/browser`,
  `akarisp/src/...`, and `akarisp/package.json` MUST fail at runtime and in type-checking. No
  path may be made public to ease validation.
- **FR-906**: AkariSP's published declarations MUST resolve under `bundler`, `node16`, and
  `nodenext`. This requirement concerns AkariSP's declarations only. The known WebLLM 0.2.85
  limitation, where WebLLM's own declarations do not resolve under `node16`/`nodenext`, is out of
  its scope and MUST NOT be reported as an AkariSP failure.

**Registry metadata versus intent**

- **FR-907**: Each published release MUST have a recorded intent:
  - version;
  - target of every dist-tag the release is meant to set;
  - expected runtime dependencies (none);
  - expected entry points.
- **FR-908**: A metadata check MUST compare the registry's name, version, dist-tags, runtime
  dependencies, and entry points against that intent, and MUST report each difference with
  field, expected, and observed values. Metadata outside the package contract is not compared.
- **FR-909**: The recorded intents MUST be:
  - **`0.1.0-alpha.0`** (retroactive; it matches the observed state): `alpha` → `0.1.0-alpha.0`,
    `latest` → `0.1.0-alpha.0`.
  - **`0.1.0-alpha.1`** (written before publishing): `alpha` → `0.1.0-alpha.1`, `latest` →
    `0.1.0-alpha.1`.

  Both releases have no runtime dependencies and entry points `.` and `./webllm`. These are the
  intended states of these releases, not a permanent policy.

**Release procedure**

- **FR-910**: The documented publish procedure MUST name the dist-tag explicitly and MUST NOT
  rely on a configured default tag.
- **FR-911**: The documented procedure MUST require writing the release intent before
  publishing and running the metadata check (FR-908) after publishing, with the result
  recorded. It MUST NOT introduce release automation, release trains, or semantic-release-style
  tooling.
- **FR-921**: The post-publish check (FR-908) MUST tolerate brief registry propagation delay.
  - It re-reads the registry within a bounded waiting window, whose length is set in the plan.
  - It reports a mismatch only if the difference persists past the window.
  - It records the time of each read and the number of attempts.
  - It never waits without bound, and never reports stale data as a pass.
- **FR-920**: When the post-publish check finds a mismatch, the procedure MUST fix forward:
  - a dist-tag mismatch is corrected with an explicit dist-tag command and the check is re-run;
  - an artifact-content defect is corrected by publishing the next version, never by
    unpublishing;
  - each mismatch and its correction is recorded in the discrepancy record.
- **FR-912**: The procedure MUST cover moving `latest` explicitly when the release intent
  requires it. It MUST NOT fix a permanent dist-tag policy; the alpha-period preference
  (`alpha` and `latest` both on the newest alpha until the first stable) is recorded as the
  current preference only.

**Documentation and records**

- **FR-913**: The README MUST describe the current tag state as the current release state, and
  MUST NOT claim a universal npm rule for first publications.
- **FR-914**: The README Release section and the 008 research record MUST be corrected. They
  must not claim the configured default tag is applied, and the `latest` mechanism must be
  stated as undetermined. The expected, observed, and corrected states of the first-publication
  discrepancy MUST be recorded in one place.
- **FR-915**: 009 MUST publish `0.1.0-alpha.1` as a documentation/metadata correction release,
  so that the npm package page shows the corrected README.
  - The release carries no runtime source change.
  - Its intent (FR-907) MUST be written before publishing. It explicitly names the target of
    `alpha` and of `latest`; the current preference is both on `0.1.0-alpha.1`.
  - The publish command MUST name the tag (FR-910). Any `latest` move the intent requires MUST
    be an explicit step (FR-912).
  - The post-publish registry check (FR-908) and the registry-consumer validation (FR-901–906)
    MUST pass against `0.1.0-alpha.1`, and the result MUST be recorded.
  - The maintainer runs the publication and any tag command, because they need the
    maintainer's authentication.
- **FR-916**: The configured default publish tag, observed not to be applied, MUST be removed
  from the package metadata before `0.1.0-alpha.1` is packed.

**Scope guards**

- **FR-917**: Production runtime source MUST NOT change unless registry evidence proves a
  defect; any such change requires separate, explicit justification.
- **FR-918**: The existing local packed-artifact validation (008) MUST remain unchanged in
  purpose. The registry validation complements it and MUST NOT replace it. Shared test helpers
  are an implementation detail.
- **FR-919**: The registry validation MUST NOT make the repository's default offline test run
  depend on network access.

### Key Entities

- **Release intent**: for one version, the version plus the intended target of each dist-tag,
  the expected runtime dependencies, and the entry points. Written before publishing.
- **Registry state**: what the public registry reports for the package at a point in time:
  versions, dist-tags, and per-version metadata.
- **Registry consumer**: a clean project outside the repository that installs from the public
  registry only.
- **Discrepancy record**: expected versus observed versus corrected for one release-process
  finding. The first one is the `latest` tag.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-901**: Before `0.1.0-alpha.1`, an untagged install and an `alpha` install from the
  public registry both resolve to `0.1.0-alpha.0`. After it, both resolve to `0.1.0-alpha.1`.
  Each result is recorded with the date and the registry used.
- **SC-902**: 3/3 public imports succeed and 4/4 internal path groups fail, at runtime and in
  types, from the registry-installed consumer.
- **SC-903**: AkariSP's declarations resolve under 3/3 module-resolution modes.
- **SC-904**: 5/5 contract metadata fields (name, version, dist-tags, runtime dependencies,
  entry points) match the recorded intent, for `0.1.0-alpha.0` before the correction release and
  for `0.1.0-alpha.1` after it. A deliberately wrong intent value is reported as a difference
  (demonstrated once).
- **SC-908**: The npm package page for `0.1.0-alpha.1` shows the corrected README. The package
  metadata of `0.1.0-alpha.1` has no configured default publish tag.
- **SC-905**: 0 installation or release statements in the README or in the 008/009 records
  contradict the registry evidence or present observed behavior as a universal npm rule.
- **SC-906**: The documented release procedure requires an explicit tag, a written intent, and
  a recorded post-publish check. No new release tooling or dependency is added.
- **SC-907**: 0 production runtime source changes (or each change has recorded evidence), and
  the existing test suite passes offline unchanged.

## Assumptions

- The public npm registry (`registry.npmjs.org`) is reachable when the registry validation runs.
  The validation is run on demand by the maintainer, not as part of the offline default test
  run.
- Registry reads and anonymous installs need no credentials. The `0.1.0-alpha.1` publication
  and any dist-tag command are run by the maintainer, who authenticates themselves.
- The command used for the first publication is unknown, and 009 does not try to reconstruct
  it. The mechanism that created `latest` stays undetermined unless new evidence appears.
- The consumer environment matches 008's: current Node and npm, and the repository's TypeScript
  version for type checks.
- Optional release hygiene is out of scope unless the plan shows it is needed for FR-913–915:
  a GitHub Release for `0.1.0-alpha.0` with short notes, the npm link, tested provider versions,
  and known alpha limitations.
- Non-goals, unchanged from the input:
  - no new Runtime APIs or lifecycle, scheduler, queue, cancellation, or streaming changes;
  - no provider abstractions, public SPI, registry, routing, fallback, or new providers;
  - no model downloader;
  - no framework integrations, package split, or monorepo;
  - no telemetry, agent, workflow, RAG, or plugin systems;
  - no semantic-release, complex automation, or release trains.
