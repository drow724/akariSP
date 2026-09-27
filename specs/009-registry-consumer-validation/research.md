# Research: Registry Consumer Validation

Environment: Node 23.9, npm 10.9.2, TypeScript 5.9, public registry `https://registry.npmjs.org/`,
2026-09-27. Only network reads and anonymous installs of `akarisp` were run. Nothing was
published.

## Baseline experiments (G1–G3)

| ID | Experiment | Observed | Implication |
|---|---|---|---|
| G1 | `npm view akarisp --json` | `versions: ['0.1.0-alpha.0']`; dist-tags `alpha`/`latest` → `0.1.0-alpha.0`; exports `.`, `./webllm`; no `dependencies`; 13 files, 41,694 B | The registry exposes every contract field needed for FR-908 in one read |
| G2 | Two isolated consumers (empty user npm config, explicit `--registry`, `--prefer-online`), installing `akarisp` and `akarisp@alpha` | Both resolved `0.1.0-alpha.0` in ≤ 1 s. `node_modules` contains only `akarisp`. `import('akarisp/webllm')` → `['createWebLLMRuntime']` | Registry install from a clean consumer is fast and deterministic enough for an on-demand check |
| G3 | `npm publish --dry-run` with and without `--tag alpha` (recorded in 008 research) | Without the flag: tag `latest` despite `publishConfig.tag: alpha`. With the flag: `alpha` | FR-910 and FR-916: name the tag explicitly and remove the config |

## R1. Release intent: form and location

- **Decision**: One JSON file per released version, `releases/<version>.json`, for example:

  ```json
  { "version": "0.1.0-alpha.1", "distTags": { "alpha": "0.1.0-alpha.1", "latest": "0.1.0-alpha.1" },
    "dependencies": {}, "exports": [".", "./webllm"] }
  ```

  - It is written before publishing and committed with the release.
  - `releases/0.1.0-alpha.0.json` is written retroactively and marked as such in the commit.
  - `releases/` is outside `files`, so it is never packed.
- **Rationale**: The check (FR-908) needs a machine-readable intent to compare against. One
  file per version keeps the history, and the first discrepancy stays visible next to its
  intent. There is no schema or tooling: it is plain JSON that the check reads.
- **Alternatives**:
  - Prose in `research.md`: rejected, because the check would need hard-coded expectations,
    which go stale (spec edge case "tags move later").
  - A single `release.json` for the current release: rejected, because it loses the alpha.0
    record.
  - A `CHANGELOG`: rejected, because it is not needed for FR-907.

## R2. Where the registry validation runs

- **Decision**:
  - The test file is `test/registry/registry.test.ts`.
  - It is run by the new script `"test:registry": "node --test test/registry/registry.test.ts"`, which names the file explicitly so a "0 tests" pass cannot occur.
  - The default `npm test` glob (`test/*.test.ts`) does not include it, so the offline suite
    stays offline (FR-919).
  - The version under test is `RELEASE=<version>`, defaulting to the repository
    `package.json` version.
- **Rationale**: Network checks are on demand. Before alpha.1 is published, the command is
  `RELEASE=0.1.0-alpha.0 npm run test:registry`.
- **Alternatives**:
  - Adding it to `npm test` behind an environment flag: rejected, because a flag is easy to
    forget and it mixes offline and online failures.
  - A CI workflow: rejected, because the repository has no CI and FR-911 excludes automation.

## R3. Isolation from local npm state

- **Decision**: Every npm call in the registry test runs with:
  - `npm_config_userconfig` pointed at an empty temp file;
  - an explicit `--registry=https://registry.npmjs.org/`;
  - `--prefer-online`;
  - `--no-package-lock`;
  - the consumer in `os.tmpdir()`.

  The registry URL and the npm version are recorded in the result.
- **Rationale**: This covers the spec edge case "local npm cache or global configuration". The
  user config cannot redirect the registry, and `--prefer-online` revalidates cached metadata.
  G2 showed the setup works.
- **Alternatives**: a fresh cache directory per run. Rejected: `--prefer-online` already
  revalidates, and a fresh cache only makes the run slower.

## R4. Propagation window (FR-921)

- **Decision**:
  - Metadata reads (`npm view akarisp@<version> --json` plus `npm view akarisp dist-tags --json`)
    retry every 20 s for up to 10 minutes, until every field matches the intent.
  - After the window, the remaining differences are reported (field, expected, observed).
  - Each attempt's time is recorded.
  - Installs run only after the metadata matches, so they read settled data.
- **Rationale**: 10 minutes is a practical bound for npm's metadata caching. It is a practical
  estimate, not an npm guarantee, so both the window and the interval are constants at the top
  of the test and are recorded in the result. With a matching registry (G1), the first attempt
  passes and the run takes seconds.
- **Override for the mutation demo**: `REGISTRY_WINDOW_MS` overrides the window, so that a
  deliberately wrong intent (SC-904) fails immediately instead of after 10 minutes. It has no
  other use.
- **Point in time**: the check verifies the registry *now* against one release's intent. After
  `0.1.0-alpha.1` moves the tags, a re-run for `0.1.0-alpha.0` reports the tag difference, which
  is correct. The `.verified.json` of each release records its own verification moment.
- **Alternatives**:
  - A single read: rejected by the clarification.
  - An unbounded wait: rejected by FR-921.

## R5. Reusing 008's consumer checks (FR-918)

- **Decision**:
  - Move the consumer-side helpers out of `test/package.test.ts` into `test/consumer.ts`, which
    the `*.test.ts` glob does not collect. The helpers are: `run` (a child process in the
    consumer), the `tsc` invocation, the internal-path list, and the export-keys probe.
  - Both `test/package.test.ts` (local tarball) and `test/registry/registry.test.ts`
    (registry) import them.
  - The fixtures `test/consumer/{root,webllm,internal}.ts` are shared.
- **Rationale**: The same observable checks (public imports, internal failures, 3 resolution
  modes) are applied to two different artifact sources, with no duplicated logic. 008's tests
  keep their assertions: only their helper location moves.
- **Not in the registry check**:
  - The API snapshot and the README-sample compile. They are artifact properties that 008
    already verifies before publish; FR-904–906 do not require them from the registry.
  - The allow-list. The file list is an artifact property that 008 fixes before publish; the
    spec's five contract fields do not include it.
  - The CommonJS probe. It is not part of the spec's registry scope.

## R6. Recording results

- **Decision**: Each run writes `releases/<version>.verified.json`, and the file is committed as
  evidence. It contains:
  - timestamp, npm version, and registry URL;
  - the metadata attempts (time and matched or differing fields);
  - the resolved version for the untagged install and the `alpha` install;
  - the check results.

  A failing run still writes the file (with the differences) and then fails.
- **Rationale**: FR-908, FR-920, and FR-921 require recorded results, and a JSON file next to
  the intent is the smallest durable record.
- **Alternatives**: console output copied by hand. Rejected: it is easy to lose.

## R7. The correction release `0.1.0-alpha.1` and the package metadata

- **Decision**:
  - Remove `publishConfig` from `package.json` (FR-916).
  - Bump the version to `0.1.0-alpha.1`. 008's package test asserts the version literal; that
    assertion is updated to the new version as an intentional, listed change (008 FR-816).
  - No `src/` changes.
- **Publish procedure** (maintainer, per FR-910–912), documented in the README Release section:
  1. Commit `releases/0.1.0-alpha.1.json`.
  2. Run `npm publish --tag alpha`.
  3. Run `npm dist-tag add akarisp@0.1.0-alpha.1 latest`, as the intent requires.
  4. Run `RELEASE=0.1.0-alpha.1 npm run test:registry`.
  5. Commit the `.verified.json`.
  6. If a mismatch is reported, apply FR-920.

## R8. Documentation corrections

- **README Install**:
  - State that during the alpha period the current release intent points `alpha` and `latest`
    at the newest alpha, so both install commands give it.
  - Label this as the current release state, not an npm rule and not a permanent policy.
- **README Release**: replace the `publishConfig.tag` text with the R7 procedure, and point to
  `releases/`.
- **008 research "First publish"**:
  - Correct the attribution. The mechanism that created `latest` is undetermined: the CLI
    default and the registry are both consistent with the evidence.
  - Add G3.
  - Keep the original text's facts. Mark the correction with a dated note instead of
    silently rewriting.
- **Discrepancy record**: in `specs/009-registry-consumer-validation/research.md`, section
  "Discrepancy record", with the expected, observed, corrected, and verified states.
- **No GitHub Release**: FR-913–915 do not need one.

## Implementation evidence

### Baseline (T001)

`npm test` 145/145 pass (offline). `npm view akarisp dist-tags --json --prefer-online` →
`{"alpha":"0.1.0-alpha.0","latest":"0.1.0-alpha.0"}`; `versions` → `["0.1.0-alpha.0"]`.

### Shared helpers (T002)

The consumer helpers moved to `test/consumer.ts`, and `test/package.test.ts` binds them to its
tarball consumer. `git diff` shows no changed `assert` line. `npm test` passes 145/145, the same
as the baseline. `npm test` does not collect `test/registry/` (still 145 tests).

### Mutation check (T008, V3; run before T007)

The intent was set to `distTags.latest: "9.9.9"`, then this ran:

```bash
REGISTRY_WINDOW_MS=0 RELEASE=0.1.0-alpha.0 npm run test:registry
```

- 5 tests: 1 pass, **1 fail** (metadata), 3 skipped (no consumer installed).
- The recorded verdict was `mismatch`.
- The differences were `[{"field":"distTags.latest","expected":"9.9.9","observed":"0.1.0-alpha.0"}]`.

The intent was then edited back. The normal run (T007) overwrote the result file (SC-904).

### Registry verification of `0.1.0-alpha.0` (T007, V2)

`RELEASE=0.1.0-alpha.0 npm run test:registry` ran 5/5 tests in 10.3 s, with verdict `match`.
The result is in `releases/0.1.0-alpha.0.verified.json`:

- **Metadata**: matched on attempt 1 (2026-09-27T08:19:17Z, npm 10.9.2, `registry.npmjs.org`).
- **Installs**: `akarisp` and `akarisp@alpha` both resolved to `0.1.0-alpha.0`, and
  `node_modules` contained only `akarisp`.
- **Imports**: the public imports passed, and all 7 internal paths failed with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Types**: `bundler`, `node16`, and `nodenext` all passed in both consumers.

### Package metadata for `0.1.0-alpha.1` (T009) and intent (T010)

- **`package.json`**:
  - `publishConfig` removed (FR-916).
  - `version` changed to `0.1.0-alpha.1`.
  - Script `test:registry` added.
- **Only assertion change in 009**: `test/package.test.ts`, where the version literal changed
  from `'0.1.0-alpha.0'` to `'0.1.0-alpha.1'`.
- **Dry-runs (V4)**:
  - `npm publish --dry-run --tag alpha` → `version: 0.1.0-alpha.1`, `with tag alpha`.
  - Without the flag → `with tag latest`: the same as before the removal (G3). The removed
    config had no effect with npm 10.9.2.
- `npm test` passes 145/145.
- `releases/0.1.0-alpha.1.json` is written before any publish: `alpha` and `latest` →
  `0.1.0-alpha.1`.

## Discrepancy record

### D1: `latest` on the first publication

| State | Content |
|---|---|
| Expected (008 FR-813, before publishing) | `alpha` → `0.1.0-alpha.0`; `latest` absent; a plain `npm install akarisp` would not select the alpha |
| Observed (2026-09-27) | `alpha` → `0.1.0-alpha.0`; **`latest` → `0.1.0-alpha.0`**. Both install commands give the alpha |
| Cause | **Undetermined.** The first-publish command was not recorded. npm 10.9.2 ignored `publishConfig.tag` in a dry-run (G3), so an unflagged publish would have used `latest`. The registry also documents that every package has `latest`. Both explanations fit, and neither is established |
| Correction | `publishConfig` removed. The procedure always names the tag (README "Release"). Per-release intent files (`releases/`) record the tag state, starting with the retroactive `releases/0.1.0-alpha.0.json` (verified: `releases/0.1.0-alpha.0.verified.json`). The README install text is limited to the current release. The 008 research has a dated correction note |
| Verified | 2026-09-27: `0.1.0-alpha.1` published with an explicit `--tag alpha`, and `latest` moved explicitly. The registry check matched `releases/0.1.0-alpha.1.json` (`releases/0.1.0-alpha.1.verified.json`, T014) |

### D2: the stale README on the npm package page

| State | Content |
|---|---|
| Observed | The npm page shows the README packed in `0.1.0-alpha.0`, which says a plain install selects nothing until a stable release |
| Correction | `0.1.0-alpha.1` is a documentation and metadata correction release (FR-915) |
| Verified | The registry README for `0.1.0-alpha.1` (`npm view akarisp@0.1.0-alpha.1 readme`) contains the corrected install text (T015) |

### Publication and registry verification of `0.1.0-alpha.1` (T013, T014)

**Maintainer steps** (authenticated, from the pushed 009 branch at `374f22f`):
1. `npm publish --tag alpha`: the CLI announced `with tag alpha`, then printed
   `+ akarisp@0.1.0-alpha.1` and "being processed and may take a few minutes".
2. `npm dist-tag add akarisp@0.1.0-alpha.1 latest`: printed `+latest: akarisp@0.1.0-alpha.1`
   and "may take a few minutes to take effect".

**Propagation lag.** For about 2 minutes after both commands, `npm dist-tag ls` and direct
registry reads (`/-/package/akarisp/dist-tags` and the packument) still showed only
`0.1.0-alpha.0`. The version was absent too.

**Registry check.** `RELEASE=0.1.0-alpha.1 npm run test:registry` passed 5/5 in 155 s with
verdict `match` (`releases/0.1.0-alpha.1.verified.json`):

- **Metadata:**
  - Attempt 1, at 08:22:50Z, had 5 differences: version not found, and both tags still on
    alpha.0.
  - Attempt 8, at 08:25:16Z (≈ 2 min 26 s later), had none.
  - The bounded re-check (FR-921) absorbed a real propagation delay instead of reporting a
    false mismatch.
- **Installs:** `akarisp` and `akarisp@alpha` both resolved to `0.1.0-alpha.1`, with no extra
  packages.
- **Imports:** the public imports passed and the 7 internal paths failed.
- **Types:** bundler, node16, and nodenext all passed.

### Final audit (T015)

| Check | Result |
|---|---|
| Registry dist-tags | `alpha` and `latest` → `0.1.0-alpha.1` |
| V6: npm page README | The registry README of `0.1.0-alpha.1` contains the corrected install text ("For the `0.1.0-alpha.1` release, both `alpha` and `latest` …") (SC-908) |
| `publishConfig` in published metadata | none (`npm view akarisp@0.1.0-alpha.1 publishConfig` is empty) |
| `git diff main -- src/` | empty (SC-907) |
| Offline `npm test` | 145/145. The only assertion change is the version literal (T009) |
| `npm run test:browser` | 21/21 |
| V7 | The remaining attribution in 008 spec FR-813's post-publish note ("the registry also created `latest`") was reworded to "mechanism undetermined". The 008 research keeps its original text followed by the dated correction note. No README or record statement presents observed npm behavior as a universal rule (SC-905) |
