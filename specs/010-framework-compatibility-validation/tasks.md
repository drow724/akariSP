---

description: "Task list for 010-framework-compatibility-validation"
---

# Tasks: Framework Compatibility Validation

**Input**: Design documents from `/specs/010-framework-compatibility-validation/`

**Prerequisites**: plan.md, spec.md (clarified: Q1–Q3 in specify, 2 in clarify), research.md
(F1–F3, R1–R8), data-model.md, contracts/fixture-contract.md, quickstart.md; 009 merged;
`akarisp@0.1.0-alpha.1` on npm.

**Tests**: Included. The automated spec plus manual records are the product of this feature.

**Scope boundary**:
- 0 `src/` changes and 0 root dependencies.
- No framework-specific AkariSP API, hook, composable, store, plugin, export, or package.
- Fixtures are test assets only and are never published.
- `npm ci`/`npm install` in fixtures downloads toolchains (R8), so **ask the user for approval
  before the first install**.
- No model or browser download.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: spec user stories:
  - US1: React/Vue/Svelte + Vite
  - US2: Next.js boundary
  - US3: per-ecosystem conclusions
  - US4: documentation

---

## Phase 1: Setup

- [X] T001 Record the baseline in a new "Implementation evidence" section at the end of
  `specs/010-framework-compatibility-validation/research.md`:
  - `npm test` (expect 145/145);
  - `npm run test:browser` (expect 21/21);
  - `npm view akarisp dist-tags --json`.

  No code changes.

---

## Phase 2: Foundational (stand-in + automated harness)

**⚠️ Blocks all fixtures.**

- [X] T002 Create `fixtures/standin.js` per `contracts/fixture-contract.md`. It is a plain
  script, not a module, and is injected before application code.
  - **Global**: it defines `globalThis.LanguageModel` with `create(options)`, which returns a
    base whose `clone({signal})` returns a task with `prompt`, `promptStreaming`, and
    `destroy`.
  - **Counters**: `globalThis.__akari = { creates, destroys, clones, cloneDestroys, hold: false }`.
  - **Streaming**: `promptStreaming` yields `'a'` and `'b'`, then waits while `__akari.hold` is
    true (a 10 ms poll is fine). When the signal aborts, it throws `signal.reason`.
  - **Clone**: `clone` rejects with `signal.reason` if the signal is already aborted.

  It is never imported by any fixture.
- [X] T003 Create `playwright.frameworks.config.ts`:
  - `testDir: 'e2e-frameworks'`, Chromium project only.
  - `webServer` is an array that starts with **only the React entry**:
    `cwd: 'fixtures/react-vite'`, port 5173.
    - Playwright starts every `webServer` regardless of `-g`, so each fixture adds its own entry
      when it is created (H1): T007 adds `vue-vite` (5174), T008 adds `svelte-vite` (5175), T010
      adds `next` (5176).
  - The Vite command is `npm ci && npm run build && npm run preview -- --port <p> --strictPort`.
  - The Next.js command (added in T010) is
    `npm ci && npm run build && npm run start -- -p 5176 > server.log 2>&1` (M1). Its server
    output goes to `fixtures/next/server.log`, which is gitignored in `fixtures/next/.gitignore`.
  - `reuseExistingServer: false` and a generous timeout (300 s).

  Add `"test:frameworks": "playwright test -c playwright.frameworks.config.ts"` to
  `package.json`. Confirm that `npm run test:browser` still uses `playwright.config.ts` and
  collects only `e2e/` (21 tests).
- [X] T004 Create `e2e-frameworks/frameworks.spec.ts`. It exports a helper `ownership(page, base)`
  that:
  1. injects `fixtures/standin.js` with `page.addInitScript({ path })`;
  2. collects `console` lines `akarisp:create` and `akarisp:shutdown`, and `pageerror` events;
  3. runs the fixture-contract sequence:
     - load;
     - wait for `#state` = `ready`;
     - click `#run`, then wait for `#out` to contain `ok`;
     - click `#stream`, then wait for `#out` to contain `ab`, with `hold` false so it
       completes;
     - set `__akari.hold = true`, click `#stream`, wait for `ab`, then click `#toggle`
       (unmount mid-stream; this is unmount 1);
     - click `#toggle` exactly 4 more times (mount, unmount, mount, unmount), each time waiting
       for `#state` = `ready` after a mount, so there are exactly 3 mounts and 3 unmounts, ending
       unmounted (L1);
  4. waits until the counters settle (poll up to 5 s);
  5. returns
     `{ creates, destroys, clones, cloneDestroys, logCreates, logShutdowns, errors }`.

  The shared assertion is `creates === destroys === 3`, `clones === cloneDestroys`,
  `logCreates === logShutdowns === 3`, and `errors = []`.
  - Each test writes its own record (data-model "Result record", `mode: 'automated'`) to
    `fixtures/results/automated-<id>-<YYYY-MM-DD>.json`.
  - There is one file per environment, so parallel workers never write the same file (M3).
  - The date is the run date, from `new Date().toISOString().slice(0, 10)` (L2).

---

## Phase 3: User Story 1 — React/Vue/Svelte + Vite (P1)

**Goal**: each Vite fixture keeps AkariSP's ownership and cleanup through its framework's
ordinary primitive.

**Independent test**: `npm run test:frameworks -- -g "<env>"` passes, or records a finding for
that environment.

- [X] T005 [US1] **Ask the user for approval to download toolchains**, then scaffold
  `fixtures/react-vite/`:
  - **`package.json`**: exact pins `react` and `react-dom` `19.3.0`, `vite` `8.3.1`,
    `@vitejs/plugin-react` `6.1.1`, `akarisp` `0.1.0-alpha.1`. Scripts: `dev`, `build`,
    `preview`.
  - **`vite.config.js`**, **`index.html`**, and **`src/main.jsx`**, which renders
    `<StrictMode><App/></StrictMode>` with the `#toggle` parent.
  - **`src/Owner.jsx`**: the **straightforward** pattern (R2).
    - In `useEffect`: `let rt; createRuntime().then((r) => { rt = r; console.info('akarisp:create'); setRuntime(r); });`
    - Cleanup: `return () => { rt?.shutdown().then(() => console.info('akarisp:shutdown')); };`
    - Buttons `#run`/`#stream` and `#state`/`#out` per the contract, using only `createRuntime`
      from `akarisp`.
  - Run `npm install` to create `package-lock.json` from the public registry, and commit both.
  - Confirm that `node_modules/akarisp/package.json` has version `0.1.0-alpha.1`.
- [X] T006 [US1] Add the React test to `e2e-frameworks/frameworks.spec.ts`,
  `ownership(page, 'http://localhost:5173')`, and run `npm run test:frameworks -- -g react`.
  - If it passes, record `PASS`.
  - If creations and shutdowns do not balance (the expected risk: a runtime resolving after
    unmount), record the exact counts as the straightforward-pattern finding. Do **not** change
    the fixture yet (T015 handles it).
- [X] T007 [P] [US1] Scaffold `fixtures/vue-vite/` in the same way, and add its `webServer`
  entry (port 5174) to `playwright.frameworks.config.ts` (H1):
  - pins: `vue` `3.5.43`, `vite` `8.3.1`, `@vitejs/plugin-vue` `6.0.9`, `akarisp`
    `0.1.0-alpha.1`;
  - `src/App.vue` has the `#toggle` and `v-if` owner;
  - `src/Owner.vue` creates in `onMounted` and shuts down in `onBeforeUnmount` (the
    straightforward pattern);
  - `npm install` creates the lockfile, and both are committed.
- [X] T008 [P] [US1] Scaffold `fixtures/svelte-vite/` in the same way, and add its `webServer`
  entry (port 5175) to `playwright.frameworks.config.ts` (H1):
  - pins: `svelte` `5.57.1`, `vite` `8.3.1`, `@sveltejs/vite-plugin-svelte` `7.3.1`, `akarisp`
    `0.1.0-alpha.1`;
  - `src/App.svelte` has the `#toggle` and `{#if}` owner;
  - `src/Owner.svelte` uses `onMount` returning the shutdown cleanup (the straightforward
    pattern);
  - the lockfile is committed.
- [X] T009 [US1] Add the Vue and Svelte tests (ports 5174 and 5175), run them, and record the
  results as in T006.

---

## Phase 4: User Story 2 — Next.js boundary (P1)

**Goal**: the App Router application builds and server-renders, creates runtimes only in the
browser, cleans up on navigation, and the server-evaluated probes are observed.

**Independent test**: `npm run test:frameworks -- -g next` passes its assertions and records the
probe observations.

- [X] T010 [US2] Scaffold `fixtures/next/`:
  - **`package.json`**: exact pins `next` `16.3.6`, `react` and `react-dom` `19.3.0`,
    `akarisp` `0.1.0-alpha.1`. Scripts: `dev`, `build`, `start`.
  - **`app/layout.jsx`**.
  - **`app/page.jsx`**: a server component rendering `<Owner/>`, the `#toggle` parent, and a
    link `#to-other`.
  - **`app/owner.jsx`**: starts with `"use client"` (in the fixture, not AkariSP) and uses the
    same straightforward React pattern as T005.
  - **`app/other/page.jsx`**: has a link `#to-home`.
  - **`app/server-import/page.jsx`**: a server component that imports `createRuntime` and
    renders `typeof createRuntime`.
  - **`app/server-create/page.jsx`**: `export const dynamic = 'force-dynamic'`, and calls
    `await createRuntime()` inside a server component.
  - Commit the lockfile.
  - Add `fixtures/next/.gitignore` containing `server.log`, `.next/`, and `node_modules/`.
  - Add the Next.js `webServer` entry (T003) to `playwright.frameworks.config.ts` (H1).
- [X] T011 [US2] Add the Next.js tests to `e2e-frameworks/frameworks.spec.ts`. Record the build
  and server log observations in the Next.js record's `next` field.
  - **(a) Server-rendering and hydration (M2).** The criterion is fixed at three checks:
    1. `page.request.get('/')` returns 200, and its HTML contains `#toggle`.
    2. `fixtures/next/server.log` contains no `LanguageModel` / `ReferenceError` line after
       that request. A server-side creation would necessarily throw that error (research F2),
       so its absence shows that 0 runtimes were created on the server.
    3. After loading `/` with the stand-in, `__akari.creates === 1` once `#state` = `ready`.
  - **(b) Ownership sequence** at base `:5176`.
  - **(c) Navigation.** `/` → `#to-other` → `#to-home`: `destroys` increases by 1 on leave and
    `creates` by 1 on return.
  - **(d) Server-import probe.** `/server-import` → 200 with text `function`.
  - **(e) Server-create probe.** Request `/server-create`, then record the HTTP status and the
    new error lines appended to `fixtures/next/server.log` (M1; expected:
    `ReferenceError: LanguageModel is not defined`). This is recorded as an observation, not
    asserted as the desired behavior (FR-1010, FR-1012). Request it after (a), so its error lines
    cannot affect check (a)2.

---

## Phase 5: Manual runs (US1 + US2)

- [X] T012 [US1] Hand the user the manual procedure (quickstart M1–M3), and record each result
  in `fixtures/results/<id>-manual-<YYYY-MM-DD>.json` (the run date, L2) (data-model "Result record",
  `mode: 'manual'`). For each of React, Vue, and Svelte:
  1. Run `npm run dev` in `fixtures/<id>` and open it in Chrome with the built-in model.
  2. Count the console `akarisp:create`/`shutdown` lines after the initial load. For React
     this includes StrictMode.
  3. Edit `Owner.*` once (for example, a text change) and count the lines again (HMR).
  4. Toggle 3 times.
  5. Run and stream once with the real Prompt API.

  Execution is `BLOCKED` if the model is unavailable.
- [X] T013 [US2] Do the same for Next.js (M4):
  1. Run `npm run dev`: initial load, one edit to `app/owner.jsx`, and `/` → `/other` → `/`.
  2. Run and stream once with the real Prompt API.
  3. Look at `/server-create` in dev mode and record its error.

---

## Phase 6: Findings and the fixed pattern (US1/US2, only if needed)

- [X] T014 [US3] Classify every imbalance or error from T006, T009, T011, T012, and T013 as
  either:
  - a **development-only** effect (StrictMode or HMR), or
  - a **straightforward-pattern leak**, which also appears in production.

  Write the cause for each, with evidence, in `research.md`.
- [X] T015 [US3] Only for environments where T014 found a straightforward-pattern leak: add the
  **fixed pattern** to that fixture's owner, then re-run its automated test and the relevant
  manual step. The fixed pattern, using only framework primitives and the public API:
  - a local `let cancelled = false` set to `true` in cleanup;
  - a created runtime that resolves after cleanup is shut down immediately (and logs
    `akarisp:shutdown`).

  Record the straightforward and fixed results side by side. Keep the straightforward variant
  in the record, not in the code.

---

## Phase 7: Conclusions and documentation (US3 + US4)

- [X] T016 [US3] Add a "Results" table to `research.md` with one row per environment. Its
  columns are the versions, install, dev, build, serve, browser, ownership counts, dev
  behaviors, final, and the links to the records. Add a "Conclusions" section with exactly one
  FR-1018 outcome per ecosystem (React, Vue, Svelte, Next.js), each citing its records, and
  record the FR-1012 conclusion for server-side creation. Every "candidate future feature" or
  "candidate core feature" is only described and proposed; nothing is built for it.
- [X] T017 [US4] Add a short "Using with frameworks" section to `README.md`, only for ecosystems
  concluded as "existing API sufficient" or "documentation sufficient". It covers:
  - where the runtime is created;
  - who calls `shutdown()`;
  - the fixed pattern, if T015 needed it;
  - for Next.js, the client-component boundary and not creating a runtime in server code.

  Every snippet must match a validated fixture file and use only existing public names.

---

## Phase 8: Polish & audit

- [X] T018 Final audit, recorded in `research.md`:
  - `git diff main -- src/` is empty (SC-1006);
  - `npm test` passes 145/145 and `npm run test:browser` passes 21/21 (V1);
  - `npm run test:frameworks` is green, or its failures match recorded findings;
  - `npm pack --dry-run` still lists 13 files, so fixtures are not packed;
  - 4/4 result records are complete (SC-1001) and 4/4 conclusions are present (SC-1005);
  - the README snippets match the fixtures (SC-1007).

---

## Dependencies & Execution Order

```text
T001 → T002 → T003 → T004 → T005 (approval) → T006
     → T007 ∥ T008 (each adds its webServer) → T009 → T010 (adds the Next.js webServer) → T011 → T012 → T013 → T014 → [T015] → T016 → T017 → T018
```

- T005 gets the download approval, which covers all four fixture installs.
- T007 and T008 are parallel: different directories.
- T012 and T013 need the user at Chrome with the model.
- T015 runs only if T014 finds a leak.

## Implementation Strategy

- **MVP**: T001–T006. The harness plus React + Vite, the highest-risk lifecycle (StrictMode,
  async creation).
- **Coverage**: T007–T011, adding Vue, Svelte, and the Next.js boundary.
- **Evidence and decision**: T012–T018, covering the manual runs, findings, conclusions, and
  documentation.

## Traceability

| Requirement | Tasks |
|---|---|
| FR-1001 four environments | T005, T007, T008, T010 |
| FR-1002 published package | T005, T007, T008, T010 (exact `akarisp` pin, lockfile) |
| FR-1003 pinned, reproducible, excluded | T005–T010, T003, T018 |
| FR-1004 public API only | T005, T007, T008, T010, T017 |
| FR-1005 install/dev/build/serve/browser statuses | T004, T006, T009, T011, T012, T013 |
| FR-1006 ownership, 3 cycles, run, stream, unmount mid-stream | T004, T006, T009, T011 |
| FR-1007 dev double mount, HMR | T012, T013, T014 |
| FR-1008 stand-in for automated, real provider for manual | T002, T012, T013 |
| FR-1009 Next.js App Router | T010, T011 |
| FR-1010 server import/create observed | T010, T011, T013 |
| FR-1011 no Next.js-specific AkariSP code | T010, T018 |
| FR-1012 server-create conclusion | T011, T016 |
| FR-1013 semantics authoritative | T014 |
| FR-1014 0 `src/` changes | T018 |
| FR-1015 boundaries only | T004 |
| FR-1016 offline suite unaffected | T003, T018 |
| FR-1017 result records | T004, T012, T013, T016 |
| FR-1018 conclusions | T014, T015, T016 |
| FR-1019 README | T017 |
| SC-1001–1007 | T016, T006/T009/T011, T006/T009/T011, T011, T016, T018, T017 |

---

## Phase 9: Convergence

- [X] T019 Document the T014 additions in the design artifacts, per T014/FR-1018 (unrequested). Docs only, with no code change:
  - In `specs/010-framework-compatibility-validation/contracts/fixture-contract.md`, add the stand-in's `__akari.createDelay` (it delays `create()` so a test can unmount while creation is pending).
  - In `quickstart.md` V2, describe the per-environment pending-unmount check and the resulting 8 tests.
  - In the source tree of `plan.md`, add `fixtures/next/app/toggle.jsx` (the client toggle a server-component page needs).
