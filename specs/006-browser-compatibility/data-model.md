# Data Model: Browser Compatibility Validation

In-page state only (`smoke/streaming.js`); no production types.

| Entity | Fields | Rules |
|---|---|---|
| Runner | `kind` (`playwright` \| `manual` \| `ci-safari`), `engine` or `browser` | From URL params only; never from UA; evidence layer per FR-520 |
| Capability report | `languageModelPresent`, `availability` (raw \| null), `classification`, `error?`, plus top-level `secureContext`, `userAgent`, `recordedAt` | Classification per research C3; UA never used for decisions |
| Check result | `status`, `reason?`, `durationMs?`, `error?`, `info?` | Gated per C4, executed outcome per C5; `reason` required when not PASS; `info` never read by outcome logic |
| Result document | runner + capability report + `tests` map + `overall` | `overall` per C6; shape per [contracts/result-json.md](contracts/result-json.md) |
| Evidence file | a saved result document under `smoke/results/` | Dated evidence; read by nothing |

Check keys: `import`, `run`, `streaming`, `earlyBreak`, `callerAbort`, `shutdownDuringStreaming`,
`lazyStream`, `cloneIsolation` (1 import check + 7 lifecycle checks).
