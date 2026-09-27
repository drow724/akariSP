# Research: Framework Compatibility Validation

Environment: macOS, Node 23.9, npm 10.9.2, Playwright 1.63 with Chromium already installed
(since 006), 2026-09-27. Reads from the public registry only. Nothing was installed into the
repository.

## Baseline (F1–F3)

| ID | Experiment | Observed | Implication |
|---|---|---|---|
| F1 | Import the registry `akarisp@0.1.0-alpha.1` in a server-side Node process | Both entry points import. No browser global is read | Server-evaluated imports (Next.js server components, SSR, prerendering) should be safe; to be confirmed inside Next.js |
| F2 | `createRuntime()` in the same process | Rejects with `ReferenceError: LanguageModel is not defined` | Server-side creation fails with a generic error (FR-1012) |
| F3 | `npm view <pkg> version` on 2026-09-27 | vite 8.3.1, react/react-dom 19.3.0, @vitejs/plugin-react 6.1.1, vue 3.5.43, @vitejs/plugin-vue 6.0.9, svelte 5.57.1, @sveltejs/vite-plugin-svelte 7.3.1, next 16.3.6 | These exact versions are pinned in the applications (FR-1003) |

## R1. Validation applications: location, language, pinning

- **Decision**:
  - Four minimal applications, one per environment: `fixtures/react-vite`, `fixtures/vue-vite`,
    `fixtures/svelte-vite`, `fixtures/next`.
  - Each has its own `package.json` pinning the F3 versions and `"akarisp": "0.1.0-alpha.1"`
    exactly, plus a committed `package-lock.json`. They install with `npm ci` from the
    registry.
  - The code is plain JavaScript (`.jsx`, `.vue`, `.svelte`, and `.jsx` for Next.js).
- **Rationale**:
  - The lockfiles make reruns reproducible (clarification Q2 of `/speckit-clarify`), and the
    exact `akarisp` version comes from the registry (FR-1002).
  - JavaScript keeps these applications about lifecycle. The type surface of the published
    package was already validated in 008 and 009 under three resolution modes, and the tool
    chains' current TypeScript major (7.x) would add an unrelated variable.
  - `fixtures/` is outside `files` (not packed), outside `test/*.test.ts` and `tsconfig`
    `include: ["src"]`, and outside the existing Playwright `testDir: 'e2e'`. The offline suite
    and `test:browser` are therefore unaffected (FR-1016).
- **Alternatives**:
  - Generating the applications per run: rejected by the clarification.
  - TypeScript fixtures: rejected, because the type surface is already covered and TS 7 would add
    noise.
  - A workspace or monorepo: a non-goal.

## R2. Ownership pattern under test

- **Decision**: each application has one owner component, created through the framework's own
  primitive:
  - React: `useEffect` with a cleanup function.
  - Vue: `onMounted` and `onBeforeUnmount`.
  - Svelte: `onMount` returning a cleanup function.
  - Next.js: a client component using the same React pattern.

  The component creates a runtime on mount and calls `shutdown()` on unmount. It has buttons for
  `run()`, `stream()`, and "unmount" (a parent toggle). It writes `akarisp:create` /
  `akarisp:shutdown` to `console.info` after each call resolves.

  The code is written first in the **straightforward form**: create on mount, shut down in
  cleanup if a runtime exists. This tests the "existing API sufficient" condition of FR-1018
  honestly. The expected problem is a runtime whose creation resolves after unmount (the React
  development double mount, or a fast toggle). If it appears, the fixed pattern (also shut down
  a late runtime) is added and both results are recorded. This is the FR-1018 "documentation
  sufficient" evidence.
- **Rationale**: the decision rule compares the straightforward code with the fixed pattern, so
  both must be observed rather than assumed.
- **Alternatives**: writing the defensive pattern from the start. Rejected, because it would hide
  exactly the friction this feature must measure.

## R3. Provider: stand-in for automated runs, real Prompt API for manual runs

- **Decision**:
  - `fixtures/standin.js` is a test-only script injected by Playwright (`page.addInitScript`)
    before any application code. It defines a `LanguageModel` global with `create`, `clone`,
    `prompt`, `promptStreaming`, and `destroy`, and counts them on `globalThis.__akari`
    (`creates`, `destroys`, `clones`, `cloneDestroys`). `promptStreaming` yields chunks until
    released, so an unmount mid-stream can be forced.
  - The applications never import it, and AkariSP is unchanged.
  - Manual runs use the real Chrome Prompt API: no injection, a machine with the model.
- **Rationale**:
  - The browser provider reads `LanguageModel` only at runtime creation (F1, F2). A global
    installed before the application loads is therefore the one public seam, the same
    technique as the 006 harness.
  - Base counts show that `shutdown()` really destroyed every base (runtime closed).
  - Clone counts show task cleanup, including a stream cut off by unmount.
- **Alternatives**:
  - A test provider through internals: rejected, because the SPI is private (008).
  - WebLLM in the applications: rejected, because it adds a model download and is not needed to
    expose framework lifecycle.

## R4. Automated runs (FR-1006, clarification Q1)

- **Decision**:
  - A new, separate Playwright config, `playwright.frameworks.config.ts`, with its test in
    `e2e-frameworks/frameworks.spec.ts`, run by the script `"test:frameworks"`.
  - Per environment, `webServer` runs `npm ci && npm run build && <preview>`: `vite preview`, or
    `next start` for Next.js, each on its own port.
  - The spec injects `standin.js` and runs the ownership sequence:
    1. mount, then `run()`, then `stream()` (fully read);
    2. unmount while a stream is active;
    3. two more mount/unmount cycles.
  - It then asserts: `creates === destroys`, `clones === cloneDestroys`, the console
    `akarisp:create` count equals the `akarisp:shutdown` count, and there are no page errors.
  - Production builds only. Development behaviors are manual (R5).
  - Chromium only (see the spec Assumptions).
- **Rationale**:
  - Automated and repeatable, and it needs no model.
  - The existing `test:browser` (21 checks on 3 engines) and the offline `npm test` stay
    untouched.
  - The run needs network access for `npm ci`, like `test:registry`.
- **Alternatives**: extending the existing config. Rejected, because it would make
  `test:browser` depend on four toolchains.

## R5. Manual runs (development behaviors and the real provider)

- **Decision**: per environment, one guided run recorded in
  `fixtures/results/<env>-<date>.json`:
  - Development server: count the console `akarisp:create`/`shutdown` lines after initial load.
    In React that includes StrictMode's double effect.
  - Edit the owner file once (HMR) and count the create/shutdown lines again.
  - Toggle mount/unmount 3 times.
  - With the real Prompt API: run once and stream once.

  The observations use the result-record shape (data-model.md), `PASS`/`FAIL`/`BLOCKED`/`SKIPPED`.
  If the model is unavailable, execution is `BLOCKED` and the framework results stand.
- **Rationale**: this is clarification Q1 (development behaviors are manual) and Q2 (the real
  provider is exercised once).

## R6. Next.js specifics (FR-1009 to FR-1012)

- **Decision**: App Router only.
  - `app/page.jsx`, a server component, renders the owner `app/owner.jsx`. The `"use client"`
    directive is in the **fixture's** file, not in AkariSP (FR-1011).
  - `app/other/page.jsx` is for navigation away and back.
  - `app/server-import/page.jsx` is a server component that imports `createRuntime` and renders
    `typeof createRuntime` (FR-1010).
  - `app/server-create/page.jsx` has `export const dynamic = 'force-dynamic'` and calls
    `createRuntime()` in the server component (FR-1010, FR-1012). It is request-time only, so it
    cannot fail the build, and it is never linked from the main flow.
  - The automated spec checks the following:
    - The build succeeds.
    - `/` server-renders without a server error.
    - The stand-in counters show 0 creates before hydration and exactly 1 after hydration.
    - Navigating `/` → `/other` → `/` shows the runtime shut down on leave and re-created on
      return.
    - `/server-import` renders `function`.
    - `/server-create` responds with a server error whose log contains the observed
      `ReferenceError`. That is recorded, not asserted as desired.
- **Rationale**: the server-evaluated cases are isolated routes, so the main path stays a clean
  compatibility check and the misuse cases are still observed.

## R7. Results and conclusions

- **Decision**:
  - `fixtures/results/` holds the manual-run records.
  - The automated run prints a record per environment and writes `fixtures/results/automated-<id>-<date>.json` (one file per environment).
  - `specs/010-framework-compatibility-validation/research.md` gets a results table and one
    conclusion per ecosystem (FR-1018), using the rule from `/speckit-clarify`.
  - README: a short "Using with frameworks" section, only for patterns that a validated
    application uses (FR-1019).

## R8. Cost and permissions

- **Installs**: `npm ci` for four applications downloads framework toolchains from the registry,
  roughly 100–300 MB. This needs user approval at implementation time.
- **No other downloads**: no Playwright browser download (Chromium is installed) and no model
  download (the stand-in is used, and the manual real-provider run uses a model the user already
  has).

## Implementation evidence

### Baseline (T001)

`npm test` 145/145, `npm run test:browser` 21/21, registry dist-tags `alpha` and `latest` →
`0.1.0-alpha.1` (2026-09-27).

### Automated runs (T005–T011): 4/4 PASS

`npm run test:frameworks` (Chromium, production builds, stand-in `LanguageModel`, straightforward
owner pattern) runs 4/4 tests in about 30 s. Records are in
`fixtures/results/automated-<id>-2026-09-27.json`.

**All environments**
- **Install**: `akarisp` 0.1.0-alpha.1 was installed from the registry (`npm install`, then
  `npm ci`) and confirmed in `node_modules/akarisp/package.json`.
- **Ownership sequence**: mount, `run`, `stream`, unmount during a held stream, then 2 more
  mount/unmount cycles.
- **Balance**: creates 3 = destroys 3, clones 3 = task destroys 3, console
  `akarisp:create` 3 = `akarisp:shutdown` 3, and 0 page errors.

**Vite fixtures**

| Environment | Pinned versions |
|---|---|
| react-vite | react/react-dom 19.3.0, vite 8.3.1, @vitejs/plugin-react 6.1.1 |
| vue-vite | vue 3.5.43, vite 8.3.1, @vitejs/plugin-vue 6.0.9 |
| svelte-vite | svelte 5.57.1, vite 8.3.1, @sveltejs/vite-plugin-svelte 7.3.1 |

Each fixture's own build, preview, and browser steps passed.

**next** (next 16.3.6, react 19.3.0, App Router)

| Check | Result |
|---|---|
| Build | `/`, `/other`, and `/server-import` were prerendered **statically at build time**. The server evaluated `akarisp` and server-rendered the client owner with no error. `/server-create` is dynamic |
| (a) SSR | `/` returned 200 with `#toggle`, and `server.log` has no `LanguageModel`/`ReferenceError` line, so 0 server runtimes. After hydration, `creates` = 1 |
| (b) Ownership | Balanced, as in the table above |
| (c) Navigation | `/` → `/other` → `/` gave creates 2 and destroys 1: shut down on leave, re-created on return |
| (d) `/server-import` | 200, and it renders `function` |
| (e) `/server-create` | Observed 500 with the server log line `⨯ ReferenceError: LanguageModel is not defined` |

**Mutation check.** Removing `shutdown()` from the React owner's cleanup fails the test:
`destroys` is 0 where 3 was expected. The check detects a leak.

**Observations unrelated to AkariSP**
- `@sveltejs/vite-plugin-svelte` 7.3.1 prints `EBADENGINE` on Node 23.9, since it declares
  `^20.19 || ^22.12 || >=24`. The build still succeeds.
- Next.js warns about multiple lockfiles and picks the repository root as its workspace root.
  This is an artifact of nesting the fixture inside this repository, not something consumers
  see.
- Next.js needs a client component for the toggle state (`app/toggle.jsx`) as well as
  `app/owner.jsx`. The `"use client"` directives are in fixture files only.

**Limit of these runs.** They wait for `#state` = `ready` before every unmount, so they do not
exercise an unmount that happens **while `createRuntime()` is still pending**. That case is
checked in the manual runs (T012/T013): React StrictMode's development double mount, and a
quick double toggle.

### Manual runs (T012, T013): development servers, real Chrome Prompt API

Records are in `fixtures/results/<id>-manual-2026-09-27.json`. B (run and stream with the real
model) and C (slow toggles) passed in all four. Counts are the cumulative console
`akarisp:create` / `akarisp:shutdown` lines.

| Env | A: initial load | D: after quick toggles (cumulative) | E: HMR edit | Next.js F |
|---|---|---|---|---|
| react-vite | **2 / 0** | **6 / 3** | no new lines (Fast Refresh kept the component) | — |
| vue-vite | 1 / 0 | 3 / 3 | no new lines (component kept) | — |
| svelte-vite | 1 / 0 | 3 / 3 | +1 shutdown, +1 create (remount, balanced) | — |
| next | **2 / 0** | **6 / 3** | no new lines (Fast Refresh) | navigation passed; `/server-create` → overlay "LanguageModel is not defined" at `page.jsx (8:38)` |

### Classification (T014)

**Finding.** With the straightforward pattern, a runtime whose `createRuntime()` resolves
**after** the owner's cleanup has run is never shut down.

- **Development only?** No. The problem occurs in production too.
  - A new automated check in production builds delays the stand-in's `create()` by 300 ms and
    unmounts before it resolves.
  - Result: `creates 1 / destroys 0`, one runtime leaked, in **4/4** environments
    (`pendingUnmount` in each `automated-<id>` record).
- **Why React and Next.js leak in development.** Their development StrictMode runs the effect,
  its cleanup, then the effect again. The first creation always resolves after its cleanup, so
  every mount leaks one runtime (A: 2 / 0). That is a development trigger for the same
  production race, not a separate problem.
- **Why Vue and Svelte were balanced in the manual D step.** The manual quick toggles were not
  faster than creation. The race still exists there, as the production check shows.
- **HMR.** No leak and no duplicate in any environment. React/Next.js Fast Refresh and Vue kept
  the component; Svelte remounted it cleanly.
- **Not an AkariSP contract violation.** `createRuntime()` is asynchronous and returns a runtime
  that its caller owns. The owner code dropped a runtime it created. Every lifecycle count
  inside AkariSP (clones, task cleanup, shutdown) is balanced (T006–T011).
- **Side observation.** `createRuntime()` takes no `AbortSignal`, so a pending creation cannot be
  cancelled, only shut down after it resolves. The correct pattern therefore briefly creates,
  then destroys, a base session. This is recorded; it is not proposed here.
- **Server-side creation (FR-1012).** It fails with `ReferenceError: LanguageModel is not defined`
  (production: HTTP 500 and a server log line; development: an error overlay pointing at the
  exact `createRuntime()` call). The error names the missing browser global and the overlay
  points at the call site.

### Fixed pattern (T015): straightforward vs fixed, side by side

The fixed pattern uses only framework primitives and `createRuntime`/`shutdown`:

- **Cleanup side**: a local `cancelled` flag is set by the owner's cleanup (React `useEffect`
  cleanup, Vue `onBeforeUnmount`, Svelte `onMount` return).
- **Creation side**: when `createRuntime()` resolves after that, the runtime is shut down
  immediately instead of being adopted.

| Env | Straightforward: pending-unmount (production) | Fixed: pending-unmount (production) | Ownership sequence (both) |
|---|---|---|---|
| react-vite | creates 1 / destroys 0 (**leak**) | 1 / 1 | 3 / 3, tasks 3 / 3 |
| vue-vite | 1 / 0 (**leak**) | 1 / 1 | 3 / 3, tasks 3 / 3 |
| svelte-vite | 1 / 0 (**leak**) | 1 / 1 | 3 / 3, tasks 3 / 3 |
| next | 1 / 0 (**leak**) | 1 / 1 | 3 / 3, tasks 3 / 3 |

`npm run test:frameworks` passes 8/8 with the fixed pattern. The fixtures keep only the fixed
pattern in code; the straightforward results are kept here and in the manual records.

**Development re-run with the fixed pattern (T015, manual, real Prompt API):**

| Env | A: initial load | D: cumulative after quick toggles |
|---|---|---|
| react-vite | 2 / **1** | 6 / **6** |
| next | 2 / **1** | 6 / **6** |

StrictMode still creates twice, but the first runtime is now shut down when it resolves. Counts
are balanced whenever the owner is unmounted.

## Results

| Env | Versions | Install | Dev | Build | Serve | Browser | Ownership (automated) | Pending unmount: straightforward → fixed | Dev behaviors (manual) | Final |
|---|---|---|---|---|---|---|---|---|---|---|
| react-vite | react 19.3.0, vite 8.3.1, plugin-react 6.1.1 | PASS | PASS | PASS | PASS | PASS | 3/3, tasks 3/3 | 1/0 → 1/1 | StrictMode leaked 1 per mount → fixed 2/1; Fast Refresh: no churn | PASS (fixed pattern) |
| vue-vite | vue 3.5.43, vite 8.3.1, plugin-vue 6.0.9 | PASS | PASS | PASS | PASS | PASS | 3/3, tasks 3/3 | 1/0 → 1/1 | no double mount; HMR: no churn | PASS (fixed pattern) |
| svelte-vite | svelte 5.57.1, vite 8.3.1, plugin-svelte 7.3.1 | PASS | PASS | PASS | PASS | PASS | 3/3, tasks 3/3 | 1/0 → 1/1 | no double mount; HMR remount balanced | PASS (fixed pattern) |
| next | next 16.3.6, react 19.3.0 | PASS | PASS | PASS | PASS | PASS | 3/3, tasks 3/3 | 1/0 → 1/1 | as React; SSR 200, 0 server runtimes, 1 after hydration; navigation 2/1 | PASS (fixed pattern) |

AkariSP `0.1.0-alpha.1` from the registry in all four. Records:
`fixtures/results/automated-<id>-2026-09-27.json` and `fixtures/results/<id>-manual-2026-09-27.json`.

## Conclusions (FR-1018)

| Ecosystem | Conclusion | Evidence |
|---|---|---|
| React (Vite) | **Documentation sufficient** | The straightforward effect leaks a runtime whose creation resolves after cleanup: pending-unmount 1/0 in production, StrictMode 2/0 in development. The fixed pattern (a `cancelled` flag in the effect cleanup, and shutting down a late runtime) uses only `useEffect` and the public API, and balances every case: 1/1, 3/3, development 2/1 and 6/6. No hook or package is needed |
| Vue (Vite) | **Documentation sufficient** | Same race (pending-unmount 1/0). The same fixed pattern with `onMounted`/`onBeforeUnmount` balances it (1/1). HMR and development runs were balanced |
| Svelte (Vite) | **Documentation sufficient** | Same race (1/0). The same fixed pattern in `onMount` and its cleanup balances it (1/1). HMR remount was balanced |
| Next.js (App Router) | **Documentation sufficient** | Importing `akarisp` in server-evaluated code is safe: static prerender at build and a `/server-import` 200. A client component owning the runtime server-renders with 0 server runtimes and creates 1 after hydration, and navigation shuts down and re-creates. The React fixed pattern applies unchanged. No AkariSP `"use client"`, export, or SSR detection is needed: the client boundary is the application's |
| Vite (tool) | No action | Development, production build, and preview worked in 3/3 fixtures with no configuration beyond each framework's plugin |

- **Why "documentation sufficient" and not "candidate future feature".** Under the rule from
  `/speckit-clarify`, the required pattern is short and fixed. It needs no AkariSP internals
  (only "`createRuntime()` is asynchronous and the caller owns the result"), and AkariSP's
  lifecycle contract is kept with framework primitives alone. **No adapter feature is
  justified** by this evidence.
- **Server-side creation (FR-1012): documented.** Creating a runtime in server-evaluated code
  fails with `ReferenceError: LanguageModel is not defined`. The development overlay points at
  the exact `createRuntime()` line, and production logs the same message. This is adequate to
  diagnose once the documentation states "create the runtime only in client code". No core
  change is proposed.
- **Observation, not proposed.** `createRuntime()` accepts no `AbortSignal`, so a pending
  creation can only be shut down after it resolves. The fixed pattern is correct with that;
  cancellation of creation would be a separate feature if evidence ever requires it.
- **Core defects found: none.** Production source was unchanged (FR-1014).

### Final audit (T018)

| Check | Result |
|---|---|
| `git diff main -- src/` | empty (SC-1006): 0 production changes |
| New AkariSP API, entry point, or package | none. Framework code lives only in `fixtures/` |
| `npm test` / `npm run test:browser` / `npx tsc --noEmit` | 145/145, 21/21, pass. Fixtures are not collected (FR-1016) |
| `npm run test:frameworks` | 8/8: 4 ownership and boundary tests, plus 4 pending-unmount tests with the fixed pattern |
| `npm pack --dry-run` | 13 files; no `fixtures/` in the tarball |
| Untracked build outputs | 0 `node_modules`, `dist`, `.next`, or `server.log` entries (per-fixture `.gitignore`) |
| Result records | 8 (4 automated, 4 manual) (SC-1001) |
| Conclusions | 4/4 ecosystems, each citing records (SC-1005); Vite: no action |
| README | "Using with frameworks" shows only the validated fixed pattern (test logging removed) and existing API names (`createRuntime`, `shutdown`) (SC-1007). Its snippets use `jsx`/prose, so the 008 README compile check (5 `js` samples) is unchanged |
