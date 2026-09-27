---

description: "Task list for 008-package-public-api-stabilization"
---

# Tasks: Package and Public API Stabilization

**Input**: Design documents from `/specs/008-package-public-api-stabilization/`

**Prerequisites**: plan.md, spec.md, research.md (P1–P4, R1–R10), data-model.md,
contracts/public-api.md, quickstart.md (V1–V9); 007 merged.

**Tests**: Included. The package test is written first and must fail on the current package
before any change (T002). The tarball is the product.

**Scope boundary**:
- 008 does **not** run `npm publish`. It is done when the tarball is publish-ready, not when a
  package is published.
- `npm publish` (which goes to `alpha` via `publishConfig.tag`) is a separate step after
  `/speckit-converge`, run by the maintainer.
- No lifecycle code changes (FR-808). No new dependency (FR-810).
- No model or Playwright browser-binary downloads.

**Decisions fixed for implementation** (do not revisit in tasks):
- Signature: positional `createWebLLMRuntime(engine, options?)` → `Promise<Runtime>`. Confirmed
  2026-09-27.
- Public names: `akarisp` = the existing 8; `akarisp/webllm` = `createWebLLMRuntime` only.
  `WebLLMEngine` is not importable.
- `readonly` only on `RuntimeSnapshot` fields. Run/stream options stay anonymous. ESM only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: spec user stories:
  - US1: install and use the root API from the tarball
  - US2: reviewed, frozen public surface
  - US3: WebLLM from the same package
  - US4: packed artifact contents
  - US5: README

---

## Phase 1: Setup

- [X] T001 Record the baseline in `specs/008-package-public-api-stabilization/research.md` under a new "Baseline run" line:
  - `npm test` pass count;
  - `npx tsc --noEmit`;
  - `npm run build`;
  - `npm pack --dry-run`: file list, packed and unpacked size, file count;
  - root value exports (`['TaskError','createRuntime']`).

  No code changes. The baseline public *surface* is extracted in T002 with the same extractor
  as T009 (M1), because the extractor does not exist yet.

---

## Phase 2: Foundational (package test, fail first)

**⚠️ Blocks every later phase**: all later tasks are verified by this test.

- [X] T002 Create `test/package.test.ts` (run by `npm test`).

  **Rule (H1)**: nothing about the package is checked from the repository process.
  - `import('akarisp')` inside the test process would resolve through Node's package
    self-reference to the repository's own `dist`, not the tarball. It is forbidden.
  - Every import runs in a child process whose `cwd` is the consumer:
    `node --input-type=module -e …` or `node -e …` for CommonJS.
  - Every metadata check reads `<consumer>/node_modules/akarisp/package.json`.

  **Shared setup** (`before()`):
  - `npm pack --json --pack-destination <tmp>` into `fs.mkdtempSync(os.tmpdir())`, outside the
    repository, so no repository source or `node_modules` is reachable;
  - write a consumer `package.json` (`"type": "module"`, private);
  - `npm install --offline --no-audit --no-fund <tarball>`;
  - clean up the temp directory in `after()`.

  **First assertions**, all executed in the consumer:
  - installed `package.json` has version `0.1.0-alpha.0`, no `dependencies`, and no `engines`;
  - `import('akarisp')` keys are `['TaskError','createRuntime']`;
  - `import('akarisp/webllm')` keys are `['createWebLLMRuntime']`.

  **Surface extractor** (used by T009): a function in `test/package.test.ts` built on the
  repository's `typescript` compiler API. No new dependency, target about 30–40 lines.
  - **What it records**: the publicly observable TypeScript signature of every export reachable
    from the `akarisp` and `akarisp/webllm` entry points of the *installed* package, resolved
    with `moduleResolution: bundler` from a consumer file. An entry point that does not
    resolve is recorded as `(missing)`.
  - **Output**: export names sorted. For functions and classes, the signature. For interfaces
    and types, each member with `readonly`/`?` and its type (`TypeFormatFlags.NoTruncation`).
  - **Local types (H2)**: when a printed type is a non-exported local type (for example
    `WebLLMEngine`, its `Chunk`, the `Prompt` alias), print its structural shape inline,
    recursively, instead of its name. That shape is what consumers are type-checked against.
    Types that are public exports or come from `lib` (`Promise`, `AbortSignal`,
    `AsyncIterable`, `Error`) stay as names. Recursion stops at those names; no general type
    printer.
  - **Snapshot test**: compares the extractor output with `api/akarisp.api.txt`. With
    `UPDATE_API=1`, it writes the file.

  **Baseline (M1)**:
  - Run `UPDATE_API=1 npm test` on the unchanged package. Copy the resulting
    `api/akarisp.api.txt` into `research.md` as "Baseline surface (BASE `c73690d`)".
  - Do not commit that baseline as the snapshot. T009 regenerates it.

  Run `npm test` and record the expected failures in `research.md`: version, missing
  `akarisp/webllm`, `engines` present. Do not change any existing test assertion.

---

## Phase 3: Public export surface (US3, US1)

**Goal**: `akarisp/webllm` exists and exports exactly one name; root exports unchanged.

- [X] T003 [US3] Add the WebLLM subpath:
  - create `src/webllm.ts` containing only
    `export { createWebLLMRuntime } from './webllm/runtime.ts';`;
  - add the `"./webllm"` entry to `exports` in `package.json`:
    `{ "types": "./dist/webllm.d.ts", "default": "./dist/webllm.js" }`.

  Keep `src/index.ts` unchanged (8 names).

  In `test/boundary.test.ts`:
  - add a test that `import('../src/webllm.ts')` value keys equal `['createWebLLMRuntime']`;
  - add a test that `src/webllm.ts` imports only `./webllm/runtime.ts`.

  (Ponytail review: these 2 boundary tests were removed afterwards as duplicates of the
  tarball export check in `test/package.test.ts` and the API snapshot.)

  In `smoke/webllm.js`, change the import to `../dist/webllm.js` (the public entry target) and
  update its comment. T002's webllm assertion now passes.

---

## Phase 4: Public surface review changes (US2)

- [X] T004 [US2] In `src/core/runtime.ts`, mark every `RuntimeSnapshot` field `readonly`:
  `state`, `active`, `queued`, `limit`, `queueCapacity`. This is a type-only change; the
  `snapshot()` implementation is unchanged.

  Run `npx tsc --noEmit` and `npm test`. Any compile error inside `src/` means the core wrote
  to a snapshot, which is a design finding: stop and report it, do not cast.

  List this change as an intentional public diff to be reviewed in T009. No other public type
  changes (data-model.md "Item review").

---

## Phase 5: Package metadata and artifact (US4)

- [X] T005 [US4] Update `package.json`:
  - `"version": "0.1.0-alpha.0"`;
  - `"publishConfig": { "tag": "alpha" }`;
  - `"license": "Apache-2.0"`;
  - `"repository": { "type": "git", "url": "git+https://github.com/drow724/akariSP.git" }`;
  - a provider-neutral `description` that mentions the Chrome Prompt API and WebLLM;
  - `"scripts.prepack": "npm run build"`;
  - remove `engines`;
  - add no `dependencies`, `peerDependencies`, `main`, top-level `types`, or `sideEffects`.

  T002's version and engines assertions now pass.
- [X] T006 [US4] In `test/package.test.ts`, assert the tarball file list equals exactly these
  13 files, in any order:
  - `LICENSE`, `README.md`, `package.json`;
  - `dist/index.js`, `dist/index.d.ts`;
  - `dist/webllm.js`, `dist/webllm.d.ts`;
  - `dist/core/runtime.js`, `dist/core/runtime.d.ts`;
  - `dist/browser/runtime.js`, `dist/browser/runtime.d.ts`;
  - `dist/webllm/runtime.js`, `dist/webllm/runtime.d.ts`.

  Read the list from `npm pack --json`. On failure, the message prints the unexpected and the
  missing files verbatim (L3). Stale `dist` output shows up there; no clean script is added.
  Record the packed size and file count in `research.md`.

---

## Phase 6: External consumer (US1, US3)

**Goal**: the tarball installs, type-checks, and imports exactly as the contract says, in a
consumer that cannot see repository sources.

- [X] T007 [P] [US1] Create the consumer fixture files. They are type-checked only, never run.
  - `test/consumer/root.ts` uses `createRuntime`, `TaskError`, and every root type in the
    documented way: run, stream with `timing`, snapshot, shutdown, template, `e.code`
    narrowing. It includes one `// @ts-expect-error` assigning to a `RuntimeSnapshot` field.
  - `test/consumer/webllm.ts` declares a local structural fake engine and passes it to
    `createWebLLMRuntime(engine, { session, queueCapacity })`, using `Runtime` from `akarisp`.
  - `test/consumer/internal.ts` imports these paths, one per line, each preceded by
    `// @ts-expect-error`:
    - `akarisp/core`, `akarisp/browser`, `akarisp/internal`;
    - `akarisp/dist/index.js`, `akarisp/dist/core/runtime.js`;
    - `akarisp/src/index.ts`, `akarisp/package.json` (L1).
- [X] T008 [US1] In `test/package.test.ts`, copy `test/consumer/*.ts` into the consumer, then:
  - Run the repository's `node_modules/.bin/tsc --noEmit --strict --target es2022 --lib es2022,dom --skipLibCheck false` once per `moduleResolution`/`module` pair: `bundler`/`esnext`, `node16`/`node16`, `nodenext`/`nodenext`. Assert exit code 0 for all three. An unused `@ts-expect-error` makes tsc fail, so every internal import must really fail.
  - Assert at runtime that each internal path from T007 rejects with `ERR_PACKAGE_PATH_NOT_EXPORTED`, using `import()` from inside the consumer directory (spawn `node --input-type=module -e` with `cwd` set to the consumer).
  - CommonJS (M2): in the consumer, spawn `node -e "const m = require('akarisp'); console.log(Object.keys(m).sort().join())"`.
    - Do not assume the result either way. Record the observed outcome in `research.md`: the
      keys, or the error code, plus the Node version.
    - Assert that outcome, so a change is detected.
    - T012 documents exactly this behavior.

---

## Phase 7: API snapshot (US2)

- [X] T009 [US2] Produce the candidate snapshot:
  1. Run `UPDATE_API=1 npm test` with the extractor from T002 against the changed package.
  2. Commit `api/akarisp.api.txt`.
  3. Diff it against the T002 baseline and record the diff in `research.md`.

  Expected intentional changes, and only these:
  - the `akarisp/webllm` entry, previously `(missing)`;
  - `createWebLLMRuntime(engine: { …expanded structural engine… }, options?: RuntimeOptions): Promise<Runtime>`;
  - `readonly` on the 5 `RuntimeSnapshot` fields.

  Any other diff line is investigated and either justified in `research.md` or reverted.

  Review the file line by line against `contracts/public-api.md`. It must contain no
  `SessionProvider`, `Session`, or `createCoreRuntime`. Non-exported local types are never
  exposed as public symbols. The snapshot records them under a
  "local types (not importable)" label with their full structural declaration, for example
  `WebLLMEngine` and `Chunk`. Confirmed with the user 2026-09-27.
- [X] T010 [US2] Mutation check (V4):
  1. Remove `readonly` from `RuntimeSnapshot.active` in `src/core/runtime.ts`, run
     `npm test`, and confirm that the snapshot test fails and names that line.
  2. Revert, then rename one `TaskTiming` field temporarily and confirm it fails the same way.
  3. Revert, then change a `WebLLMEngine` structural member in `src/webllm/runtime.ts`: flip
     the `interruptGenerate` return type, and separately remove one required member. Confirm
     each makes the snapshot test fail (H2).
  4. Revert all.

  Record the results in `research.md`. No committed file changes remain from this task other
  than `research.md`.

---

## Phase 8: WebLLM real type compatibility — RELEASE GATE (US3)

**⚠️ Must pass before the surface is considered frozen.**

- If the real `MLCEngine` does not type-check as the first argument without a cast, the public
  structural type is wrong. Fix `WebLLMEngine` in `src/webllm/runtime.ts`, then regenerate and
  review `api/akarisp.api.txt`.
- Never document around a mismatch, and never add a cast.

- [X] T011 [US3] V5, which needs a one-time npm package download. **Ask the user for permission
  first**; it downloads the npm package only, never a model.
  1. In a temp consumer outside the repository, with the packed tarball installed, run
     `npm install --ignore-scripts @mlc-ai/web-llm@0.2.85`.
  2. Type-check this file with the three resolution modes from T008, but with
     `--skipLibCheck true` (M3). The check is assignability, not the health of WebLLM's own
     declarations:

     ```ts
     import { CreateMLCEngine } from '@mlc-ai/web-llm';
     import { createWebLLMRuntime } from 'akarisp/webllm';
     const engine = await CreateMLCEngine('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
     const runtime = await createWebLLMRuntime(engine, { session: { temperature: 0 } });
     ```

     Never execute it. Do not use `as`, `any`, or `@ts-ignore`.
  3. Confirm or refute R2 (`interruptGenerate` return type) from this check only. If the real
     type returns `void`, widen it to `void | Promise<void>` in `src/webllm/runtime.ts`. If it
     returns `Promise<void>`, keep the current type and drop the planned widening.
  4. Record the exact tsc output, the web-llm version, and one verdict in `research.md`
     (P4 → resolved):
     - **PASS**: the `createWebLLMRuntime(engine, …)` call compiles with no cast.
     - **FAIL**: an error located on that call expression, meaning structural
       incompatibility. Fix the public type (step 3), regenerate and review the snapshot
       (T009), then re-run.
     - **BLOCKED**: errors only inside WebLLM's own declarations or environment, and none on
       the call. Resolve the environment; this never counts as PASS.
  5. The repository `package.json` stays without any `@mlc-ai/web-llm` entry, and no
     repository lockfile changes.

---

## Phase 9: Documentation (US5)

- [X] T012 [US5] Update `README.md`.
  - **Chrome first:**
    - Install: `npm install akarisp@alpha` (explain that `alpha` is the pre-release tag and
      that a plain `npm install akarisp` will select a stable release only after one exists).
    - Keep the existing Chrome quick start and sections.
    - Scope Chrome-only statements to Chrome: base per template via `LanguageModel.create()`,
      clone per task, broken = clone failed with `InvalidStateError`.
  - **New official "WebLLM" section:**
    - `import { createWebLLMRuntime } from 'akarisp/webllm'`
    - An example with an application-created `CreateMLCEngine`.
    - The application creates and loads the engine; AkariSP never downloads a model.
    - Ownership moves to the runtime when creation resolves; the engine is untouched if
      creation rejects.
    - `limit` must be 1 (`TypeError` otherwise).
    - `shutdown()` unloads the engine after all task cleanup.
    - `broken` = engine unloaded or lost at task start.
    - Templates are request configuration on one engine.
    - Validated with `@mlc-ai/web-llm` 0.2.85 and Qwen2.5-0.5B; other versions are unverified.
    - Types: a real `MLCEngine`, `WebWorkerMLCEngine`, or `MLCEngineInterface` is accepted
      without a cast. This was verified with `moduleResolution: bundler` (T011). WebLLM 0.2.85's
      own declarations do not resolve under `node16`/`nodenext`, where WebLLM types become
      `any`.
  - **Other sections:**
    - "Package" section: ESM only; entry points `akarisp` and `akarisp/webllm`; zero
      dependencies; TypeScript resolution `bundler`/`node16`/`nodenext`; and the observed
      CommonJS `require()` behavior exactly as recorded in T008.
    - "Development": Node ≥ 22.18 (moved from `engines`), `UPDATE_API=1 npm test` for
      intentional API changes.
    - "Release": `npm publish` uses `publishConfig.tag` `alpha`; not part of this feature.
  - **Check:** every import, option, and error code named in the README exists in
    `api/akarisp.api.txt`, and all 9 public names appear (V9).

---

## Phase 10: Polish & regression

- [X] T013 Full automated regression (V1–V3):
  - `npm test`: all pass, including `package.test.ts`;
  - `npx tsc --noEmit`;
  - `npm run build`;
  - `npm run test:browser`: 21/21.

  Confirm with `git diff --stat test/` that no existing assertion was changed or weakened; only
  additions in `boundary.test.ts` and new files.
- [X] T014 Real-browser regression. The **user** runs these:
  1. `smoke/streaming.html` → Run All → Chrome 7/7.
  2. `smoke/webllm.html` → Load model (already cached; a new download only with the user's
     permission) → Run All → 9/9.

  Save the JSON as `smoke/results/2026-09-27-macos-chrome152-008.json` and
  `smoke/results/2026-09-27-macos-chrome152-webllm-008.json`, and add the rows to
  `smoke/README.md`.
- [X] T015 Final package audit (V6), recorded in `research.md`:
  - `npm pack` → `akarisp-0.1.0-alpha.0.tgz` with 13 files; record size.
  - External install and consumer type-check pass (T008).
  - `api/akarisp.api.txt` is current and matches `contracts/public-api.md`.
  - SC-807 result from T012: README names ⊆ snapshot, and snapshot names ⊆ README.
  - `dependencies` is empty.
  - `exports` has exactly `"."` and `"./webllm"`.
  - No `engines` field.
  - `publishConfig.tag` is `alpha`.
  - Delete the local `.tgz`.
  - **Do not run `npm publish`.**

---

## Dependencies & Execution Order

```text
T001 → T002 (fail first) → T003 → T004 → T005 → T006 → T007 ∥ (written any time after T002) → T008
     → T009 → T010 → T011 (GATE; may change src/webllm/runtime.ts → re-run T009)
     → T012 → T013 → T014 → T015
```

- T011 must pass before T012: documentation describes the frozen surface only.
- T014 needs the user at a real browser. Everything before it is automated.
- Only T007 is parallel: new fixture files, not touched by T003–T006.

## Parallel example

```text
While T003–T006 run: write test/consumer/root.ts, webllm.ts, internal.ts (T007).
```

## Implementation Strategy

- **MVP (US1 + US4)**: T001–T008. A publish-ready root package verified by an external
  consumer.
- **Freeze (US2 + US3)**: T009–T011. The snapshot is committed, and a real WebLLM engine is
  proven type-compatible.
- **Release readiness (US5 + regression)**: T012–T015.
- **After `/speckit-converge`**: the maintainer runs `npm publish` (tag `alpha` from
  `publishConfig`). This is outside 008.

## Traceability

| Requirement | Tasks |
|---|---|
| FR-801 single `akarisp` | T005, T015 |
| FR-802 explicit exports, internal paths fail | T003, T007, T008 |
| FR-803 root = Chrome + neutral types | T003, T009 |
| FR-804 `akarisp/webllm`, structural engine, no dependency, no download | T003, T011 |
| FR-805/806 per-item review | data-model.md (done), T004, T009 |
| FR-807 SPI internal | T009 (snapshot lists no SPI), T008 |
| FR-808 no lifecycle change | T004 (type-only), T013, T014 |
| FR-809 allow-list, declarations | T006, T008 |
| FR-810 0 dependencies | T002, T011, T015 |
| FR-811 metadata, no dev constraints | T005 |
| FR-812 ESM only; observed `require()` behavior verified | T005, T008 (CommonJS probe), T012 |
| FR-813 `0.1.0-alpha.0`, `alpha` tag, no automation | T005, T015 |
| FR-814 external consumer, no self-reference | T002 (H1 rule), T007, T008 |
| FR-815 snapshot, including expanded local types | T002 (extractor, baseline), T009, T010 |
| FR-816 no weakened assertions | T002, T013 |
| FR-817 real browsers | T014 |
| FR-818/819 README | T012 |
| SC-801 consumer: 0 type and 0 import errors, root + webllm | T002, T008 |
| SC-802 internal paths 100% fail, public 100% succeed | T008 |
| SC-803 100% items reviewed | data-model.md, T009 (diff review) |
| SC-804 0 files outside allow-list, 0 dependencies, count/size recorded | T006, T015 |
| SC-805 single surface change fails the snapshot | T010 |
| SC-806 no weakened assertions; real browsers 7/7, 9/9 | T013, T014 |
| SC-807 README ↔ snapshot both ways | T012 (review against `api/akarisp.api.txt`), result recorded in T015 |
| SC-808 exports not grown without need | T009 (baseline diff: +1 name, Q1) |

---

## Phase 11: Convergence

- [X] T016 [US5] Type-check each `js` code sample in `README.md` once against the packed tarball. Copy each sample into a temp consumer as `.ts`, declaring only its placeholder identifiers (for example `output`, `userClickedStop`, `render`, `text`). Run the repository `tsc` under `moduleResolution: bundler`, fix any sample that fails, and record the result in `specs/008-package-public-api-stabilization/research.md` per US5/AC1 (partial)
- [X] T017 Add the T011 `interruptGenerate(): void | Promise<void>` widening to the item review and the invariants in `specs/008-package-public-api-stabilization/data-model.md`, replacing "the one type change", per FR-805 (partial)
