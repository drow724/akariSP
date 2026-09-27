# Data Model: Registry Consumer Validation

## Release intent (`releases/<version>.json`, committed)

| Field | Type | Rule |
|---|---|---|
| `version` | string | Must equal the file name's version |
| `distTags` | object tag → version | Every tag this release means to set. The check compares only the tags listed here |
| `dependencies` | object | `{}` for AkariSP (FR-903) |
| `exports` | string[] | Sorted export-map keys: `[".", "./webllm"]` |
| `retroactive` | boolean, optional | `true` only for `0.1.0-alpha.0`, whose intent was written after publishing |

Instances:

| Version | `distTags` | `retroactive` |
|---|---|---|
| `0.1.0-alpha.0` | `alpha` and `latest` → `0.1.0-alpha.0` | `true` |
| `0.1.0-alpha.1` | `alpha` and `latest` → `0.1.0-alpha.1` | — |

These are per-release intents, not a policy.

## Registry state (read, never stored except inside a result)

- `npm view akarisp@<version> --json`: `name`, `version`, `dependencies`, and `exports`.
- `npm view akarisp dist-tags --json`: the current tag map.

Only these fields are compared (FR-908).

## Verification result (`releases/<version>.verified.json`, committed)

| Field | Content |
|---|---|
| `checkedAt`, `npm`, `registry` | Environment of the run |
| `window` | `{ intervalMs, maxMs }` (R4) |
| `attempts` | `[{ at, differences: [{ field, expected, observed }] }]`; the last entry is the verdict |
| `installs` | `{ "akarisp": "<resolved version>", "akarisp@alpha": "<resolved version>" }` |
| `checks` | `{ publicImports, internalPathsFail, types: { bundler, node16, nodenext }, runtimeDependencies }`, each `true` or a failure message |
| `verdict` | `match`, or `mismatch` with its differences |

## Discrepancy record (prose, `research.md`)

Per finding: expected, observed, cause (or "undetermined"), correction per FR-920, verified
result, with links to the intent and result files.

## State transitions of a release

```text
intent written → published (explicit tag) → [explicit tag moves] → checked
  → match: verified
  → mismatch: tag fix → checked again
  → mismatch: content defect → next version
```
