# Research: Package and Public API Stabilization

Evidence was gathered on `008-package-public-api-stabilization` (from `main` at `c73690d`), Node
23.9, npm 10.9.2, TypeScript 5.9, by packing the current package and installing it into a
scratch consumer outside the repository (no network, no model download).

## Baseline experiments (P1–P4)

| ID | Experiment | Observed | Implication |
|---|---|---|---|
| P1 | `npm pack --dry-run` | 11 files, 12.1 kB packed / 37.5 kB unpacked: `LICENSE`, `README.md`, `package.json`, `dist/{index,core/runtime,browser/runtime,webllm/runtime}.{js,d.ts}`. No specs, experiments, tests, smoke, bench, src, or source maps | `files: ["dist"]` already excludes development files; the risk is stale `dist` output, not the `files` list |
| P2 | Consumer: `import('akarisp')` and `import('akarisp/dist/core/runtime.js')` | root → `['TaskError', 'createRuntime']`; deep path → `ERR_PACKAGE_PATH_NOT_EXPORTED` | The export map already blocks internal paths at runtime; the shipped internal files stay non-importable |
| P3 | Consumer type-check of the root API under `moduleResolution` `bundler`, `node16`, `nodenext` (strict, no `skipLibCheck`) | Only the intentional error in the probe; declarations resolve in all three, although `.d.ts` files keep `.ts` import specifiers (`'./core/runtime.ts'`) | Declaration emit is usable as is; no build change needed. Verified with TypeScript 5.9 only |
| P4 | Offline install of `@mlc-ai/web-llm@0.2.85` into the consumer | `ENOTCACHED` (not in the npm cache) | Checking a real WebLLM engine against the public engine type needs a one-time network install of the npm package (types only, `--ignore-scripts`; not a model). Requires user permission at implementation time |

## R1. `akarisp/webllm` public surface

- **Decision**: The subpath exports exactly one name, `createWebLLMRuntime(engine, options?)`,
  returning `Promise<Runtime>`. It is served by a new one-line entry file `src/webllm.ts` that
  re-exports only that function from `src/webllm/runtime.ts` (the same pattern as `src/index.ts`).
  `RuntimeOptions`, `Runtime`, `TaskError`, and the other shared types are imported from the root.
- **Rationale**: The design criterion is a provider-specific factory returning the
  provider-neutral `Runtime`. Pointing the export map straight at `dist/webllm/runtime.js` would
  also publish `WebLLMEngine` (exported there for the unit tests) as a second name. Users pass
  their own `MLCEngine`; they never need to name the engine type, and
  `Parameters<typeof createWebLLMRuntime>[0]` covers the rare case.
- **Signature**: positional `createWebLLMRuntime(engine, options?)`, confirmed 2026-09-27. It
  reuses `RuntimeOptions` unchanged, like `createRuntime(options)`. A single object argument
  (`{ engine, ...options }`) was rejected because it needs a new options type.
- **Alternatives**: export `WebLLMEngine` too (rejected: +1 permanent name without a
  demonstrated need; can be added later as a non-breaking minor change); re-export shared types
  from the subpath (rejected: two import paths for one type).

## R2. Engine structural type without a WebLLM dependency

- **Decision**: Keep the locally declared structural interface (`chat.completions.create`,
  `interruptGenerate`, `getMessage`, `unload`). Widen `interruptGenerate()` from `Promise<void>`
  to `void | Promise<void>`. Verify once that a real `MLCEngine` from `@mlc-ai/web-llm` 0.2.85
  type-checks as the first argument (P4), and record the result as evidence.
- **Rationale**: Zero runtime and zero type dependencies on WebLLM. WebLLM's `interruptGenerate()` is
  expected to be declared as returning `void` (from source reading; not yet type-checked, see P4).
  If so, a `Promise<void>` return in the public type would reject the real engine. The adapter
  already `await`s the call, which works for both. The P4 check confirms or refutes this before
  freeze; if refuted, the widening is dropped.
- **Alternatives**: `import type` from `@mlc-ai/web-llm` in the declarations (rejected: consumers
  without WebLLM installed get unresolved types; a peer dependency would be needed); accept
  `any` (rejected: no type safety, hides misuse).

## R3. Root exports (8)

- **Decision**: Keep all 8 names unchanged: `createRuntime`, `TaskError`, `Runtime`,
  `RuntimeOptions`, `RuntimeSnapshot`, `TaskStream`, `TaskResult`, `TaskTiming`.
- **Rationale**: Each one names something users hold or write in signatures: the factory, the
  error class for `instanceof` and `code`, the runtime, its options, and the return types of
  `snapshot()`, `stream()`, `run()`, and the `timing` field. None carries provider vocabulary
  (per-item review in [data-model.md](data-model.md)). Removing any of them only moves users to
  `ReturnType<...>` gymnastics; renaming has no concrete problem to fix.
- **Alternatives**: hide `TaskResult` / `RuntimeSnapshot` (rejected: usability loss for no
  stability gain; the shapes are public either way through `Runtime`).

## R4. Read-only markers and the anonymous task options

- **Decision**:
  - Mark all `RuntimeSnapshot` fields `readonly` (type-only change).
  - Keep `TaskResult` and `TaskTiming` mutable in the type.
  - Keep the `run()` / `stream()` options inline (`{ signal?, template? }`) with no new
    exported name.
- **Rationale**:
  - The snapshot is documented as a read-only view, but its type did not say so. That mismatch
    is the concrete problem. Adding `readonly` now is free; adding it after publish would break
    consumers that assign to it.
  - `TaskTiming` is filled in place by the core while a task runs (and `TaskStream.timing` is
    already `readonly` at the property level). Marking its fields `readonly` would need a
    separate internal mutable type for no user-visible gain.
  - A named options type would be a new export without a demonstrated need (SC-808).
    `Parameters<Runtime['run']>[1]` already names it.
- **Alternatives**:
  - `readonly` everywhere (rejected: internal type split).
  - Export `TaskOptions` (rejected: grows the surface; can be added later without breaking
    anyone).

## R5. `package.json`

- **Decision**:

  | Field | Value | Reason |
  |---|---|---|
  | `version` | `0.1.0-alpha.0` | Clarification Q2 |
  | `publishConfig.tag` | `alpha` | Makes a plain `npm publish` go to `alpha`, so the first release cannot land on `latest` by a forgotten flag. Remove when publishing a stable release |
  | `exports` | `"."` → `dist/index.{d.ts,js}`; `"./webllm"` → `dist/webllm.{d.ts,js}`; each with `types` then `default` | FR-802; nothing else importable |
  | top-level `types` / `main` | none | ESM-only package resolved through `exports`; legacy `node10` resolution is not supported (documented) |
  | `files` | `["dist"]` (unchanged) | P1: already minimal |
  | `license` | `Apache-2.0` | Matches `LICENSE` |
  | `repository` | `git+https://github.com/drow724/akariSP.git` | npm page link; publish-ready metadata |
  | `description` | provider-neutral wording (Chrome Prompt API and WebLLM) | The current text describes only the Chrome clone model |
  | `engines` | **removed** | `node >= 22.18` is a development requirement (the test runner strips TypeScript types), not a consumer runtime requirement. Published, it would warn consumers on older Node for a browser library |
  | `scripts.prepack` | `npm run build` | `npm pack`/`publish` never ship stale output |
  | `dependencies` | none | FR-810 |

- **Rationale**: Every field fixes a concrete gap found in the baseline, or is required by the
  spec. The Node requirement for contributors moves to the README "Development" section.
- **Alternatives**:
  - `devEngines` (npm ≥ 10.9). Rejected for now: it makes `npm install` in the repository fail
    on older Node, which is stricter than needed. A README line is enough.
  - `sideEffects: false`. Rejected: no measured bundle problem.
  - CommonJS build. Rejected: see R6.

## R6. Module format

- **Decision**: ESM-only. The export conditions are `types` and `default`, with no `require` or
  `import` split.
- **Rationale**:
  - The targets are browsers through bundlers or native ESM, and both consume ESM.
  - `require()` of an ESM package works in current Node (22.12+), so no second build is needed.
  - A dual build doubles the artifact and adds a dual-package hazard: two `TaskError` classes,
    so `instanceof` breaks.
- **Alternatives**: a dual ESM/CJS build (rejected for the reasons above).

## R7. Consumer verification

- **Decision**: New `test/package.test.ts`, run by `npm test`:
  1. `npm pack` (which builds) into a temp directory outside the repository.
  2. Assert the tarball file list equals an allow-list.
  3. Create a consumer project in that temp directory and `npm install --offline` the tarball.
     This works because there are zero dependencies.
  4. Type-check committed consumer files (`test/consumer/*.ts`) with the repository's
     TypeScript under `bundler`, `node16`, and `nodenext`.
  5. Dynamically import each public entry and assert its value exports.
  6. Assert that each internal path fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`:
     `akarisp/core`, `akarisp/browser`, `akarisp/internal`, `akarisp/dist/index.js`,
     `akarisp/dist/core/runtime.js`, `akarisp/src/index.ts`.
     Types for the same paths must fail too.
- **Rationale**:
  - The tarball is the source of truth, and the consumer cannot see repository sources
    because the temp directory is outside the repository.
  - It runs offline with no new tooling.
- **Alternatives**:
  - A separate script (rejected: easy to skip).
  - `publint` / `arethetypeswrong` (rejected: new dependencies for checks that are a few lines
    here).

## R8. Public API snapshot

- **Decision**: The same test prints the public surface of the installed package and compares
  it with the committed file `api/akarisp.api.txt`. `UPDATE_API=1 npm test` rewrites that file.
  - **Where the surface comes from**: a TypeScript compiler API program over the consumer. For
    each public entry it lists every export, and for each exported type it prints its members
    and their types, with no truncation.
  - **Mutation check**: removing a `readonly` or renaming a field must fail the test. This is
    demonstrated once (SC-805).
- **Local types (analysis H2)**: non-exported local types that public signatures reference
  (`WebLLMEngine`, `Chunk`, `Prompt`) are printed as their expanded structural shape, since that
  shape is what consumers are type-checked against. Public exports and `lib` types stay as names.
- **Baseline (analysis M1)**: the same extractor runs once on the unchanged package (T002). The
  candidate's diff against that baseline is recorded, so the intentional changes are visible.
- **Rationale**: The snapshot covers only what consumers can reach, so internal contract changes
  (`SessionProvider`, `Session`) do not cause false alarms. That is not true of a raw `.d.ts`
  snapshot, because `dist/core/runtime.d.ts` also declares internal types. The script is about
  30 lines and uses the TypeScript dev dependency already installed.
- **Alternatives**:
  - `@microsoft/api-extractor` (rejected: large new tool for one report).
  - Snapshot of raw `.d.ts` files (rejected: noisy).
  - `node:test` snapshots (rejected: the flag is experimental on part of the supported
    development Node range).

## R9. Browser validation after packaging

- **Decision**:
  - `smoke/webllm.js` imports `../dist/webllm.js`, the public entry target, instead of the
    internal `../dist/webllm/runtime.js`.
  - The Chrome smoke already imports `../dist/index.js`, the root target.
  - Re-run Chrome 7/7 and WebLLM 9/9 and record them as dated evidence in `smoke/results/`.
- **Rationale**: Browsers cannot resolve bare `akarisp/...` specifiers without an import map, so
  the smoke pages load the same files the export map points to. Lifecycle code is not changed
  by 008.

## R10. README

- **Decision**: Clarification Q3.
  - The README opens with `npm install akarisp@alpha`, followed by the Chrome quick start
    (current content, kept).
  - A new "WebLLM" section covers the import path and the example. It also states:
    - the application creates and loads the engine;
    - ownership transfers to the runtime on successful creation;
    - the engine is untouched if runtime creation fails;
    - `limit` must be 1;
    - the runtime unloads the engine at shutdown;
    - which WebLLM version and model the behavior was validated with;
    - what makes this runtime `broken`.
  - Chrome-specific statements move under the Chrome wording. Example: "broken: a clone failed
    with `InvalidStateError`" becomes "(Chrome) …", and the WebLLM section gives its own cause.
  - The "Development" section notes the Node ≥ 22.18 requirement.
  - The release section documents `npm install akarisp@alpha` and `publishConfig.tag`.
- **Rationale**: FR-818 and FR-819. The README must match the snapshot (SC-807).

## Implementation evidence

### Baseline run (T001, BASE `c73690d`)

`npm test` 135/135 pass; `npx tsc --noEmit` pass; `npm run build` pass. `npm pack --dry-run`:
11 files, 12,076 B packed, 37,463 B unpacked: `LICENSE`, `README.md`, `package.json`,
`dist/{index,core/runtime,browser/runtime,webllm/runtime}.{js,d.ts}`. Root value exports
`['TaskError','createRuntime']`.

### Baseline surface (T002, BASE `c73690d`, same extractor as the snapshot test)

```text
# akarisp
function createRuntime(options?: RuntimeOptions): Promise<Runtime>;
interface Runtime {
    readonly state: 'ready' | 'broken' | 'closed';
    run(input: Prompt, options?: {
        signal?: AbortSignal;
        template?: string;
    }): Promise<TaskResult>;
    stream(input: Prompt, options?: {
        signal?: AbortSignal;
        template?: string;
    }): TaskStream;
    snapshot(): RuntimeSnapshot;
    shutdown(): Promise<void>;
}
interface RuntimeOptions {
    session?: object;
    templates?: Record<string, object>;
    limit?: number;
    queueCapacity?: number;
}
interface RuntimeSnapshot {
    state: Runtime['state'];
    active: number;
    queued: number;
    limit: number;
    queueCapacity: number;
}
class TaskError extends Error {
    readonly code: 'failed' | 'cancelled' | 'rejected' | 'closed' | 'broken';
    readonly timing: TaskTiming;
    constructor(code: TaskError['code'], timing: TaskTiming, cause?: unknown);
}
interface TaskResult {
    output: string;
    timing: TaskTiming;
}
interface TaskStream extends AsyncIterable<string> {
    readonly timing: TaskTiming | undefined;
}
interface TaskTiming {
    queueWait?: number;
    acquire?: number;
    prompt?: number;
    total: number;
}
# akarisp/webllm
(missing)
# local types (not importable)
type Prompt = string | readonly object[];
```

Expected T002 failures on BASE: installed version `0.1.0` (≠ `0.1.0-alpha.0`; the `engines`
assertion after it is not reached); `akarisp/webllm` → `ERR_PACKAGE_PATH_NOT_EXPORTED`. Without
`UPDATE_API`, the snapshot test fails because `api/akarisp.api.txt` is not committed yet.

### Tarball (T006)

After T003–T005: 13 files, 12,289 B packed, 37,946 B unpacked (BASE: 11 files, 12,076 B). A
planted `dist/stale.js` makes the allow-list test fail with `unexpected: [ 'dist/stale.js' ]` (L3).

### Candidate snapshot diff (T009, baseline → `api/akarisp.api.txt`)

```diff
@@ -20,11 +20,11 @@
     queueCapacity?: number;
 }
 interface RuntimeSnapshot {
-    state: Runtime['state'];
-    active: number;
-    queued: number;
-    limit: number;
-    queueCapacity: number;
+    readonly state: Runtime['state'];
+    readonly active: number;
+    readonly queued: number;
+    readonly limit: number;
+    readonly queueCapacity: number;
 }
 class TaskError extends Error {
     readonly code: 'failed' | 'cancelled' | 'rejected' | 'closed' | 'broken';
@@ -45,6 +45,23 @@
     total: number;
 }
 # akarisp/webllm
-(missing)
+function createWebLLMRuntime(engine: WebLLMEngine, options?: RuntimeOptions): Promise<Runtime>;
 # local types (not importable)
+interface WebLLMEngine {
+    chat: {
+        completions: {
+            create(request: object): Promise<AsyncIterable<Chunk>>;
+        };
+    };
+    interruptGenerate(): Promise<void>;
+    getMessage(): Promise<string>;
+    unload(): Promise<void>;
+}
+type Chunk = {
+    choices: {
+        delta?: {
+            content?: string | null;
+        };
+    }[];
+};
 type Prompt = string | readonly object[];
```

Exactly the three intended changes: `readonly` on the 5 `RuntimeSnapshot` fields; `akarisp/webllm`
`(missing)` → `createWebLLMRuntime`; the expanded local shapes it references (`WebLLMEngine`,
`Chunk`). No other diff. The snapshot contains no `SessionProvider`, `Session`,
`createCoreRuntime`, or other internal SPI name; `WebLLMEngine` appears only under "local types
(not importable)" as a shape. Contract check: matches `contracts/public-api.md` except
`interruptGenerate`, which is decided by T011.

### Mutation check (T010, V4)

Each mutation was applied to `src/`, `node --test test/package.test.ts` was run, and the mutation was reverted:

| Mutation | Result |
|---|---|
| `RuntimeSnapshot.active` loses `readonly` | snapshot test fails; diff names `    active: number;` vs `    readonly active: number;` |
| `WebLLMEngine.interruptGenerate()` return `Promise<void>` → `void` | snapshot test fails; diff names the `interruptGenerate` line (H2: local shape is frozen) |
| `TaskTiming.queueWait` renamed | test fails earlier: `npm pack` → `prepack` build fails because the core writes `timing.queueWait`. The rename cannot reach the tarball |
| `WebLLMEngine.getMessage` removed | same: the build fails because the adapter calls `engine.getMessage()`. A required member cannot be silently dropped |
| `TaskTiming` gains `extra?: number` (compiles) | snapshot test fails; diff names `    extra?: number;` |
| `WebLLMEngine` gains `reload?(): Promise<void>` (compiles) | snapshot test fails; diff names `    reload?(): Promise<void>;` |

Every surface change fails the package test. Changes that still compile fail through the snapshot
diff, and changes that break the build fail in `npm pack`. After the reverts, `git diff src/`
shows only the intended T004 change, and the package test passes.

### WebLLM real type compatibility (T011, V5 release gate): PASS after the planned widening

**Setup**
- Temp consumer outside the repository.
- Installed with `npm install --ignore-scripts @mlc-ai/web-llm@0.2.85` (resolved 0.2.85, 3 packages)
  plus the packed tarball.
- No model download. The repository `package.json` and lockfile have no WebLLM entry.

**Checks**
- All checks ran with `--skipLibCheck true`, with no cast, `any`, or `@ts-ignore`.
- Gate file: `const engine = await CreateMLCEngine(id); await createWebLLMRuntime(engine, { session: { temperature: 0 } })`.
- Extra evidence file:
  - `CreateWebWorkerMLCEngine(...)` result;
  - a value typed `MLCEngineInterface` (WebLLM's documented engine contract).

**WebLLM's own declarations for `interruptGenerate`**

| Declaration | Return type |
|---|---|
| `MLCEngineInterface` (`lib/types.d.ts:137`) | `() => void` |
| `MLCEngine` (`lib/engine.d.ts:72`) | `Promise<void>` |
| `WebWorkerMLCEngine` (`lib/web_worker.d.ts:107`) | `void` |

**Results with `interruptGenerate(): Promise<void>` (as planned before T011)**

| Mode | `MLCEngine` (gate) | `WebWorkerMLCEngine`, `MLCEngineInterface` |
|---|---|---|
| bundler | PASS (exit 0) | FAIL at the call expression (TS2345): `The types returned by 'interruptGenerate()' are incompatible … Type 'void' is not assignable to type 'Promise<void>'` |
| node16 | BLOCKED | BLOCKED |
| nodenext | BLOCKED | BLOCKED |

- **Why node16/nodenext are BLOCKED**: WebLLM 0.2.85's own `lib/index.d.ts` uses extensionless
  relative imports (`./error`), which do not resolve in these modes. Every WebLLM import becomes
  `any`. A probe assigning `CreateMLCEngine` to `number` compiles without error, so the exit 0 in
  these modes is not evidence of compatibility.
- **The WebLLM-side problem**: this is a WebLLM declaration problem, not an AkariSP one. With
  `skipLibCheck false`, 11 diagnostics point into `node_modules/@mlc-ai`.

**Verdict**
- The gate engine (`MLCEngine`) passes under bundler.
- The real `void` return in `MLCEngineInterface` and `WebWorkerMLCEngine` confirms R2. Per T011
  step 3, the public type was widened to `interruptGenerate(): void | Promise<void>`. The adapter
  already `await`s the call, so there is no runtime change.
- After widening, under bundler, the gate engine, the worker engine, and the interface value all
  compile (exit 0).
- The snapshot diff is one line, `interruptGenerate(): Promise<void>` → `void | Promise<void>`,
  and `npm test` passes 146/146.
- The only mode that can type-check real WebLLM engines is `bundler`. The README states this.

### README ↔ snapshot (T012, SC-807)

All 9 public names, the 4 `RuntimeOptions` fields, the `signal`/`template` run options, and the 5
`TaskError` codes appear in both `README.md` and `api/akarisp.api.txt`. The README imports only
`akarisp`, `akarisp/webllm`, and (the application's own) `@mlc-ai/web-llm`.

### Automated regression (T013)

`npm test` 146/146 (135 before 008 + 2 boundary + 9 package); `npx tsc --noEmit` pass; `npm run build`
pass; `npm run test:browser` 21/21. `git diff --stat test/`: only `boundary.test.ts` +9 lines (two new
tests). No existing assertion changed.

### Real browsers (T014)

- **Chrome 152 (macOS):** 7/7 PASS, `MODEL_AVAILABLE`, overall PASS.
  Evidence: `smoke/results/2026-09-27-macos-chrome152-008.json`.
- **WebLLM 0.2.85 + Qwen2.5-0.5B:** 9/9 PASS, loaded through the public entry target
  `dist/webllm.js`. Evidence: `smoke/results/2026-09-27-macos-chrome152-webllm-008.json`.
- No lifecycle regression against 007.

### Final package audit (T015): publish-ready, not published

| Check | Result |
|---|---|
| Tarball | `akarisp-0.1.0-alpha.0.tgz`, 13 files, 13,577 B packed / 41,694 B unpacked. The size grew from T006 only because of the README |
| External install + consumer type-check | Pass under `bundler`/`node16`/`nodenext` (package test) |
| `api/akarisp.api.txt` | Current (snapshot test green); matches `contracts/public-api.md` |
| `dependencies` | none |
| `exports` | exactly `"."`, `"./webllm"` |
| `engines` | none |
| `publishConfig.tag` | `alpha` |
| SC-807 | README names ⊆ snapshot and snapshot names ⊆ README (T012) |
| Local `.tgz` | deleted |
| npm name | `npm view akarisp` → E404: not published yet, so the name is currently unclaimed (checked 2026-09-27) |

`npm publish` was **not** run. The maintainer runs it after converge; `publishConfig.tag` sends it
to `alpha`.

### Ponytail review (after T015)

- Removed the 2 boundary tests added in T003. They duplicated the tarball value-export check
  (`package.test.ts`) and the API snapshot. `test/boundary.test.ts` is now unchanged from BASE.
- `package.test.ts`: `mkdirSync` instead of spawning `mkdir`; unused `size` field dropped;
  single-use `OBSERVED_REQUIRE` inlined; redundant `existsSync` pre-check removed (a missing
  snapshot still fails through `readFileSync`).
- `npm test` 144/144 (135 + 9 package tests), `npx tsc --noEmit` pass.

### README samples compile against the tarball (T016, US5/AC1)

`test/package.test.ts` now extracts the 5 `js` samples from the README **shipped in the tarball**
(`consumer/node_modules/akarisp/README.md`) and compiles them as `.ts` with the repository
TypeScript (`moduleResolution: bundler`, strict).

- **Placeholders**: the samples are fragments of one page of usage.
  `test/consumer/readme-globals.d.ts` declares only the names they use without declaring them:
  `runtime`, `createRuntime` (the Templates sample continues the Usage sample's import),
  `output`, `userClickedStop`, `text`, `render`.
- **WebLLM stub**: `@mlc-ai/web-llm` is stubbed as returning `createWebLLMRuntime`'s engine
  parameter type, because the consumer is offline. Real `MLCEngine` compatibility is the T011
  gate.
- **Result**: all 5 samples compile.
- **Mutation**: renaming `queueCapacity` to `queueCap` in the README Usage sample fails the test,
  and it passes again after the revert. The check fails whenever the README and the published
  API disagree.

### First publish (observed registry behavior, 2026-09-27)

The maintainer ran `npm publish` with `publishConfig.tag: alpha`. `npm dist-tag ls akarisp`
afterwards:

```text
alpha: 0.1.0-alpha.0
latest: 0.1.0-alpha.0
```

The registry matches the T015 audit: 13 files, 41,694 B unpacked, no dependencies, Apache-2.0.

The assumption behind FR-813 ("`--tag alpha` → no `latest`", R5) did not hold for the first publish:

- The npm CLI documentation says a custom publish tag normally avoids updating `latest`.
- The npm registry package-metadata documentation states that every package has a `latest` tag.
- The initial publication created `latest` on the first version. No official sentence was found
  saying this happens on a first publish regardless of `--tag`, so this is recorded as
  observed registry behavior, not documented behavior.

Consequences:

- `npm install akarisp` currently installs `0.1.0-alpha.0`. The README says so.
- `latest` is left in place:
  - bare installs default to `latest`;
  - the registry expects every package to have one;
  - there is no benefit in breaking that for the first alpha.

  `npm dist-tag rm` itself supports removing tags. An earlier claim in this session that
  `latest` could not be removed was wrong.
- **Open policy, to decide before the next release:** by the documented behavior, publishing
  `0.1.0-alpha.1` with the `alpha` tag would leave `latest` on `alpha.0`. The alternative is to
  move `latest` together with each alpha (`npm dist-tag add akarisp@<version> latest`) until
  the first stable release.

**Correction note (2026-09-27, feature 009).** The "First publish" section above over-attributed
the `latest` tag to registry behavior. The mechanism is **undetermined**:

- **The first-publish command was not recorded.** Its npm log is no longer available.
- **The configured tag was not applied.** With npm 10.9.2, `npm publish --dry-run` without
  `--tag` announced `tag latest` although `publishConfig.tag` was `alpha`. `--tag alpha`
  announced `alpha` (009 research G3). So an unflagged publish from the CLI and a
  registry-created `latest` are both consistent with the evidence.
- **Follow-up in 009:**
  - `publishConfig` was removed.
  - The release procedure always names the tag and verifies the result against a written
    intent (`releases/`).
  - The discrepancy record is in `specs/009-registry-consumer-validation/research.md`.

The facts recorded above (the observed tags and registry contents) are unchanged.
