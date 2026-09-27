# Quickstart: validating 011

Prerequisites: Node ≥ 22.18 and `npm install`. V5 also needs the network and Playwright Chromium.

| # | Run | Expected |
|---|---|---|
| V1 | `npm test` | All pass. This includes the R1 tests and the new public-path provider-rejection test (R2): 146/146 (145 + 1) |
| V2 | `npx tsc --noEmit` and `npm run build` | Pass |
| V3 | `npm run test:browser` | 21/21, unchanged. This is a proportional check: 011 changes no runtime code |
| V4 | `git diff main --stat -- src/ api/ package.json` and `npm pack --dry-run` | No `src/` or `api/` change, and no `dependencies` change. 13 files |
| V5 | Optional: `node experiments/prompt-api-creation/run.mjs` | Reproduces the pre-feature evidence for the published package (Node and Chromium) |
| V6 | Read the README Usage paragraph (R4) | Every statement matches R1 or the research results. There is no identity promise, no real-browser error claim for the unavailable state, and no AkariSP capability API |

Not re-run: `test:frameworks` (010) and `test:registry` (009). 011 changes no runtime code or
package contents beyond the README, so it cannot affect those boundaries.
