# Quickstart: validating 009

Prerequisites: Node ≥ 22.18, `npm install` done, network access to `registry.npmjs.org` for
V2 and V5.

| # | Run | Expected |
|---|---|---|
| V1 | `npm test` (offline) | All pass. The 008 package test passes with the shared helpers and the version literal `0.1.0-alpha.1` |
| V2 | `RELEASE=0.1.0-alpha.0 npm run test:registry` (before publishing alpha.1) | Metadata matches `releases/0.1.0-alpha.0.json` on the first attempt. Both installs resolve `0.1.0-alpha.0`. Public imports pass, internal paths fail, 3/3 resolution modes pass. `releases/0.1.0-alpha.0.verified.json` is written |
| V3 | Mutation: temporarily change one tag in `releases/0.1.0-alpha.0.json`, then run V2 with the window shortened (`REGISTRY_WINDOW_MS=0`), then revert | Verdict `mismatch`; the differing field, expected value, and observed value are reported; the run fails |
| V4 | `npm publish --dry-run` | Announces the tag given on the command line. No `publishConfig` remains in `package.json` |
| V5 | Maintainer runs `npm publish --tag alpha`, `npm dist-tag add akarisp@0.1.0-alpha.1 latest`, then `RELEASE=0.1.0-alpha.1 npm run test:registry` | Metadata matches `releases/0.1.0-alpha.1.json`, possibly after re-reads (attempts recorded). Both installs resolve `0.1.0-alpha.1`. All checks pass |
| V6 | Open https://www.npmjs.com/package/akarisp | The README shows the corrected install and release text (SC-908) |
| V7 | Review the README Install/Release sections, 008 research "First publish", and the 009 discrepancy record | No statement contradicts the registry or presents observed behavior as a universal npm rule (SC-905) |
