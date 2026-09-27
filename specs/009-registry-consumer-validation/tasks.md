---

description: "Task list for 009-registry-consumer-validation"
---

# Tasks: Registry Consumer Validation

**Input**: Design documents from `/specs/009-registry-consumer-validation/`

**Prerequisites**: plan.md, spec.md (clarified), research.md (G1–G3, R1–R8), data-model.md,
contracts/release-procedure.md, quickstart.md (V1–V7); 008 merged; `akarisp@0.1.0-alpha.0` on npm.

**Tests**: Included. The registry check is the product of this feature.

**Scope boundary**:
- 0 `src/` changes and 0 new dependencies.
- The offline `npm test` never touches the network.
- `npm publish` and `npm dist-tag` are run **only by the maintainer** (T013). The agent never
  publishes or changes tags.
- Mismatches are fixed forward (FR-920). Never unpublish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: spec user stories:
  - US1: registry artifact is the documented product
  - US2: metadata matches intent
  - US3: release states intent and verifies
  - US4: documentation matches the registry

---

## Phase 1: Setup

- [X] T001 Record the baseline in a new "Implementation evidence" section at the end of
  `specs/009-registry-consumer-validation/research.md`:
  - `npm test` pass count (expect 145);
  - `npm view akarisp dist-tags --json`;
  - `npm view akarisp versions --json`.

  No code changes.

---

## Phase 2: Foundational (shared consumer helpers)

**⚠️ Blocks US1/US2**: the registry check reuses these.

- [X] T002 Move the consumer-side helpers out of `test/package.test.ts` into a new
  `test/consumer.ts` (not matched by the `test/*.test.ts` glob). Each helper takes the consumer
  directory as a parameter:
  - `run(consumer, code, commonjs?)`: a child process in the consumer;
  - `keys(consumer, spec)`;
  - `tsc(consumer, resolution, module, files)`: uses the repository `node_modules/.bin/tsc`;
  - the exported `internal` path list;
  - `RESOLUTIONS` (`[['bundler','esnext'],['node16','node16'],['nodenext','nodenext']]`).

  `test/package.test.ts` imports them. Its assertions stay byte-identical. Run `npm test`: it
  must report the same count as T001 (145), all passing.

---

## Phase 3: Registry artifact and metadata vs intent (US1 + US2, P1)

**Goal**: an on-demand check that installs from the public registry and compares the registry
with a written intent.

**Independent test**: `RELEASE=0.1.0-alpha.0 npm run test:registry` passes against today's
registry, and a wrong intent makes it fail with the field, expected, and observed values.

- [X] T003 [P] [US2] Write `releases/0.1.0-alpha.0.json`, the retroactive intent:

  ```json
  { "version": "0.1.0-alpha.0", "retroactive": true, "distTags": { "alpha": "0.1.0-alpha.0", "latest": "0.1.0-alpha.0" }, "dependencies": {}, "exports": [".", "./webllm"] }
  ```

  Constraints (data-model.md):
  - `version` "Must equal the file name's version";
  - `exports` are the "Sorted export-map keys";
  - the check compares "only the tags listed here".
- [X] T004 [US2] Create `test/registry/registry.test.ts` with the metadata part.
  - **Intent**: read `RELEASE` (default: `version` from the repository `package.json`) and load
    `releases/<RELEASE>.json`. A missing file fails with its path. Right after loading, assert
    that `intent.version` exactly equals the version in the file name, and fail immediately
    otherwise (L1).
  - **npm isolation**: every npm call uses `npm_config_userconfig=<empty temp file>`,
    `--registry=https://registry.npmjs.org/`, and `--prefer-online` (R3).
  - **Reads**:
    - `npm view akarisp@<RELEASE> --json` gives `name`, `version`, `dependencies`
      (missing = `{}`), and the sorted keys of `exports`;
    - `npm view akarisp dist-tags --json` gives the tag map.
  - **Compare**: build `differences: {field, expected, observed}[]` for `name` ("akarisp"),
    `version`, each tag in `intent.distTags`, `dependencies`, and `exports`.
  - **Retry (FR-921)**: every `INTERVAL_MS = 20_000` until there are no differences or
    `WINDOW_MS = 600_000` has passed. `REGISTRY_WINDOW_MS` overrides the window, for the mutation
    check only. Push `{ at, differences }` for each attempt.
  - **Script**: add `"test:registry": "node --test test/registry/registry.test.ts"` to
    `package.json`, naming the file explicitly (U3).
    - Acceptance: a run reports a non-zero test count. A "0 tests" pass is a failure of this task.
    - Confirm that `npm test` does not collect this file.
- [X] T005 [US1] Extend `test/registry/registry.test.ts` with the consumer part. It runs only
  after the metadata matches.
  - **Consumers**: create two consumers in `fs.mkdtempSync(os.tmpdir())`, each with
    `package.json` `{"type":"module","private":true}`. Install them with the same isolation flags
    plus `--no-package-lock --no-audit --no-fund`, one from `akarisp` and one from
    `akarisp@alpha`.
  - **Resolved versions**: read each from `node_modules/akarisp/package.json` (L2).
    - The `akarisp@alpha` install must equal `intent.distTags.alpha`.
    - If the intent declares a `latest` target, the bare `akarisp` install must equal it. If
      it declares none, record the observed bare-install version without treating it as a
      mismatch.
  - **No extra packages**: `node_modules` must list only `akarisp`.
  - **Checks in each consumer**, using `test/consumer.ts`:
    - `keys` gives `akarisp` → `TaskError,createRuntime` and `akarisp/webllm` →
      `createWebLLMRuntime`;
    - every `internal` path fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`;
    - copy `test/consumer/{root,webllm,internal}.ts` into the consumer, and `tsc` must exit 0
      under all 3 `RESOLUTIONS`.

  This concerns AkariSP's declarations only (FR-906).

  Never use `npm pack`, a tarball, `file:`, links, or workspaces (FR-901).
- [X] T006 [US2] Write the result to `releases/<RELEASE>.verified.json` (R6) in an `after()` hook,
  so a failing run still writes it, and then fail the run:

  ```text
  { checkedAt, npm, registry, window: { intervalMs, maxMs }, attempts, installs: { "akarisp", "akarisp@alpha" }, checks: { publicImports, internalPathsFail, types: { bundler, node16, nodenext }, runtimeDependencies }, verdict: "match" | "mismatch" }
  ```
- [X] T007 [US2] Run V2, **after T008**: `RELEASE=0.1.0-alpha.0 npm run test:registry`.
  - Expect verdict `match` on attempt 1, both installs `0.1.0-alpha.0`, and all checks passing.
  - This normal run writes the final `releases/0.1.0-alpha.0.verified.json`, overwriting the
    mutation run's file.
  - Record the result in `research.md`.
- [X] T008 [US2] Run V3, the mutation check, **before T007** (U1):
  1. Temporarily set `distTags.latest` to `"9.9.9"` in `releases/0.1.0-alpha.0.json`.
  2. Run `REGISTRY_WINDOW_MS=0 RELEASE=0.1.0-alpha.0 npm run test:registry`.
  3. Confirm the run fails and reports `{ field: "distTags.latest", expected: "9.9.9", observed: "0.1.0-alpha.0" }`.
  4. Restore the intent value by editing it back.
  5. Record the mutation result in `research.md` only (SC-904). T007 then produces the final
     `.verified.json`, so no git-based recovery is needed.

---

## Phase 4: Release procedure and correction release metadata (US3, P2)

- [X] T009 [US3] Update `package.json`:
  - remove `publishConfig` (FR-916);
  - set `"version": "0.1.0-alpha.1"`.

  In `test/package.test.ts`, change the version literal `'0.1.0-alpha.0'` to `'0.1.0-alpha.1'`.
  This is the only assertion change in this feature; list it in `research.md`.

  Run `npm publish --dry-run --tag alpha` and confirm it announces `tag alpha`. Run it without
  the flag and record which tag it announces (V4). Run `npm test`: all pass.
- [X] T010 [P] [US3] Write `releases/0.1.0-alpha.1.json` before any publish:

  ```json
  { "version": "0.1.0-alpha.1", "distTags": { "alpha": "0.1.0-alpha.1", "latest": "0.1.0-alpha.1" }, "dependencies": {}, "exports": [".", "./webllm"] }
  ```

  This is the release intent for alpha.1, not a policy (FR-909).

---

## Phase 5: Documentation (US4, P2)

- [X] T011 [US4] Update `README.md`.
  - **Install section** (L3). Limit the statement to this release: "For the `0.1.0-alpha.1`
    release, both `alpha` and `latest` are intended to point to `0.1.0-alpha.1`", so both
    install commands give it. Add "This does not define a permanent dist-tag policy." Do not
    generalize to all alpha releases or state an npm rule (FR-912, FR-913).
  - **Release section.** Replace the `publishConfig.tag` text with the procedure from
    `contracts/release-procedure.md`:
    1. Write `releases/<version>.json`.
    2. Run `npm publish --tag <tag>`.
    3. Run `npm dist-tag add akarisp@<version> <tag>` for each other tag in the intent.
    4. Run `RELEASE=<version> npm run test:registry` and commit the `.verified.json`.
    5. Fix forward on a mismatch, and never unpublish.
  - **Development section.** Add `npm run test:registry` as on demand and network-requiring.

  Run `npm test`: the README-sample compile test from 008 still passes.
- [X] T012 [P] [US4] Correct the records.
  - **008 research** (`specs/008-package-public-api-stabilization/research.md`): append a dated
    note, 2026-09-27, to "First publish". It says:
    - the mechanism that created `latest` is undetermined;
    - the first-publish command was not recorded;
    - npm 10.9.2 did not apply `publishConfig.tag` (dry-run evidence, 009 research G3);
    - the removal and the explicit-tag procedure are in 009.

    Do not delete the original text.
  - **009 research**: add a "Discrepancy record" section to
    `specs/009-registry-consumer-validation/research.md`. It gives the expected, observed,
    cause (undetermined), and correction states, and links to the `releases/` files. The
    verified result is filled in at T014.

---

## Phase 6: Maintainer publication and verification (US3 + US1, P2)

**⚠️ Needs the maintainer.** The agent stops here and hands over the exact commands.

- [ ] T013 [US3] Publish `0.1.0-alpha.1` from the reviewed 009 branch. This is a single PR (U2):
  there is no merge to main before publishing.

  **Preconditions**:
  - T009–T012 are complete.
  - The branch is committed, pushed, and ready for review.
  - The pre-publish validation passes: `npm test` and `npm run test:browser`.
  - `releases/0.1.0-alpha.1.json` is committed before the publish.

  **Manual authenticated steps**, run by the maintainer only (the agent hands over the
  commands and runs none of them):
  1. `npm publish --tag alpha`
  2. `npm dist-tag add akarisp@0.1.0-alpha.1 latest`
  3. `npm dist-tag ls akarisp`

  **After publishing**: continue T014 and T015 on the same branch, and include the verification
  evidence in the same PR. Merge only after that.
- [ ] T014 [US3] Run V5: `RELEASE=0.1.0-alpha.1 npm run test:registry`.
  - If the verdict is `match`: commit `releases/0.1.0-alpha.1.verified.json` and complete the
    discrepancy record's "verified" line.
  - If the verdict is `mismatch`:
    - For a tag difference, give the maintainer the exact `npm dist-tag add` command, then
      re-run.
    - For a content defect, stop and report it. The next step is a new version (FR-920).

    Record every attempt in both cases.

---

## Phase 7: Polish & final audit

- [ ] T015 Final audit, recorded in `research.md`:
  - V6: npm page https://www.npmjs.com/package/akarisp shows the corrected README (SC-908).
  - `npm view akarisp@0.1.0-alpha.1 publishConfig` is empty.
  - `git diff --stat main -- src/` is empty (SC-907).
  - `npm test` passes offline. The only assertion change is T009's version literal.
  - `npm run test:browser` passes 21/21.
  - V7 review: no statement in the README, 008 research, or 009 research contradicts the
    registry or presents observed behavior as a universal npm rule (SC-905).

---

## Dependencies & Execution Order

```text
T001 → T002 → T003 → T004–T006 → T008 (mutation) → T007 (normal alpha.0)
     → T009 → T010 → T011–T012 → pre-publish review (branch pushed)
     → T013 (maintainer publish) → T014 → T015 → PR merge
```

- T008 runs before T007, so the normal run writes the final alpha.0 result (U1).
- T007 must run **before** T013. After alpha.1 moves the tags, alpha.0's intent no longer matches
  (point-in-time check, R4).
- Single PR (U2): the publish is from the pushed, reviewed 009 branch, so the published README is
  the branch's README. T014/T015 evidence joins the same PR before merge.
- Parallel: T003 can be written alongside T002, T010 alongside T009, and T012 alongside T011.
  They touch different files.

## Implementation Strategy

- **MVP (US1 + US2)**: T001–T008. A working registry check, proven on alpha.0, plus a
  demonstrated mismatch report.
- **Correction release (US3 + US4)**: T009–T015. Explicit intent, docs fixed, the maintainer
  publishes, and the result is verified and recorded.

## Traceability

| Requirement | Tasks |
|---|---|
| FR-901 registry only, clean consumer | T005 |
| FR-902 untagged + `alpha` installs recorded | T005, T006 |
| FR-903 0 runtime dependencies | T004 (metadata), T005 (`node_modules`) |
| FR-904 public imports | T005 |
| FR-905 internal paths fail | T005 (runtime + types) |
| FR-906 3 resolution modes, AkariSP only | T005 |
| FR-907 intent per release | T003, T010 |
| FR-908 metadata vs intent, differences reported | T004, T006, T008 |
| FR-909 intents for alpha.0 / alpha.1 | T003, T010 |
| FR-910 explicit tag in procedure | T011, T013 |
| FR-911 intent before, check after, no automation | T010, T011, T014 |
| FR-912 explicit `latest` move, no permanent policy | T011, T013 |
| FR-913 README current state, no universal rule | T011, T015 |
| FR-914 Release section + 008 record corrected, discrepancy record | T011, T012 |
| FR-915 alpha.1 correction release | T009–T014 |
| FR-916 `publishConfig` removed | T009, T015 |
| FR-917 no `src/` change | T015 |
| FR-918 008 validation kept, shared helpers | T002 |
| FR-919 offline default suite | T004, T015 |
| FR-920 fix forward | T011, T014 |
| FR-921 bounded re-check, attempts recorded | T004, T006 |
| SC-901 | T007, T014 |
| SC-902, SC-903 | T005, T007, T014 |
| SC-904 | T007, T008, T014 |
| SC-905 | T015 |
| SC-906 | T011 |
| SC-907 | T015 |
| SC-908 | T015 |
