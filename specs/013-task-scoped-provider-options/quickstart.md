# Quickstart: validating 013 (Stages 1–2)

Prerequisites:
- Node ≥ 22.18 and `npm install`.
- For V3: desktop Chrome with the Prompt API model already available. Do not download a model for
  this feature.

| # | Run | Expected |
|---|---|---|
| V1 | `node experiments/structured-output/standin.mjs` | "ok": the parsing rule, the categories (research.md R1), the workaround rule, and the FR-1304 decision agree with fixed fixtures |
| V2 | `npm test`, `npx tsc --noEmit`, `npm run test:browser` | All pass, unchanged (146/146, 21/21) |
| V3 | `python3 -m http.server 8080`, then open `http://localhost:8080/experiments/structured-output/index.html` and press **Run** | The page refuses unless availability is `available`. Otherwise it runs 3 + 30 attempts per arm plus the supplementary checks, and shows the JSON |
| V4 | Save the copied JSON unchanged in `experiments/structured-output/results/` | The file parses, has 30 measured attempts per arm, and its summary matches a recomputation from `attempts[]` |
| V5 | Fill the decision record in `research.md` and `experiments/structured-output/README.md` | Exactly one outcome and its gate (contracts/evidence-and-decision.md) |
| V6 | `git diff main --stat -- src/ api/ test/ README.md package.json` | Empty, unless the outcome is PUBLIC_MINIMAL_EXTENSION, in which case a plan amendment comes first |

Not run: `test:frameworks`, `test:registry`, and the concurrency or cold-start harnesses. They are
unaffected because the library does not change.
