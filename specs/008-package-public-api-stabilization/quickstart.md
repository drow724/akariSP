# Quickstart: validating 008

Prerequisites: Node ≥ 22.18, `npm install` done. No network is needed except for V5 (one-time,
with permission).

| # | Run | Expected |
|---|---|---|
| V1 | `npm test` | All tests pass, including `test/package.test.ts`: tarball = 13 allow-listed files; consumer type-check passes under `bundler`/`node16`/`nodenext`; `akarisp` → `['TaskError','createRuntime']`, `akarisp/webllm` → `['createWebLLMRuntime']`; every internal path → `ERR_PACKAGE_PATH_NOT_EXPORTED` and a type error; public surface = `api/akarisp.api.txt` |
| V2 | `npx tsc --noEmit` and `npm run build` | Pass |
| V3 | `npm run test:browser` | 21/21 pass (Playwright harness unchanged) |
| V4 | Mutation: remove `readonly` from one `RuntimeSnapshot` field, run `npm test`, then revert | Snapshot test fails naming the changed line; passes after revert |
| V5 | In the scratch consumer only: `npm install --ignore-scripts @mlc-ai/web-llm@0.2.85`, type-check `createWebLLMRuntime(await CreateMLCEngine(id))` | 0 type errors (records R2 evidence). Downloads the npm package only, never a model |
| V6 | `npm pack` then inspect | `akarisp-0.1.0-alpha.0.tgz`; file count and size recorded in the evidence |
| V7 | Real Chrome: `smoke/streaming.html` Run All | 7/7 PASS; JSON saved to `smoke/results/<date>-…-008.json` |
| V8 | Real WebLLM: `smoke/webllm.html` (now loading `dist/webllm.js`) → Load model → Run All | 9/9 PASS; JSON saved to `smoke/results/<date>-…-webllm-008.json` |
| V9 | README review | Every import, option, and error code in the README exists in `api/akarisp.api.txt`, and every public name appears in the README |

`UPDATE_API=1 npm test` rewrites the snapshot. Do this only for an intentional public change,
and list the change in the PR.
