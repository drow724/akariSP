# Quickstart: validating 010

Prerequisites: Node ≥ 22.18, `npm install` done in the repository, Playwright Chromium (already
installed since 006), network access for `npm ci` in the fixtures. For M1–M4, Chrome with the
built-in model is also required.

| # | Run | Expected |
|---|---|---|
| V1 | `npm test` and `npm run test:browser` | Unchanged: 145/145 and 21/21. Fixtures are not collected |
| V2 | `npm run test:frameworks` | **8 tests**. For each of the 4 environments: `npm ci` succeeds, the production build succeeds, and the preview server starts. Then: **(1) ownership**: 3 cycles plus 1 unmount during a stream; `creates === destroys`, `clones === cloneDestroys`, console create/shutdown counts equal, 0 page errors. **(2) pending unmount**: with `__akari.createDelay = 300`, unmount before creation resolves; `destroys === creates` (the late runtime is shut down) |
| V3 | Inside V2, Next.js | `/` server-renders without error, and there are 0 stand-in creates before hydration. `/` → `/other` → `/` shuts down and re-creates. `/server-import` renders `function`. `/server-create` shows a server error, and the observed error is recorded |
| V4 | `git diff main -- src/` | Empty |
| M1–M4 | Per environment, `npm run dev` in `fixtures/<id>` with Chrome and the real Prompt API: initial load, one edit to the owner file (HMR), 3 toggles, one run, one stream | A record is written to `fixtures/results/<id>-manual-<date>.json`. React's StrictMode double effect and HMR counts are recorded. Execution is `BLOCKED` if the model is unavailable |
| V5 | Read `research.md` "Conclusions" and the README "Using with frameworks" section | 4 conclusions, each citing records. The README shows only patterns used by the fixtures |
