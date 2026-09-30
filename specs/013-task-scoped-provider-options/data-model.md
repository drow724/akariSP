# Data Model: Task-Scoped Provider Options Boundary Validation

There are no product data model changes in Stages 1 and 2. These entities describe the research
record.

## Attempt (spec: Comparison attempt)

| Field | Values |
|---|---|
| `phase` | `warmup` \| `measured` \| `creationScope` \| `streaming` |
| `arm` | `control` \| `treatment` (the supplementary phases record their own label) |
| `round`, `index` | integers; the order of execution |
| `input` | one of the 5 fixed inputs |
| `output` | raw string, unmodified; `null` on `provider_error` |
| `category` | `ok` \| `provider_error` \| `empty` \| `fence` \| `not_json` \| `schema_mismatch` (first match wins; research.md R1) |
| `error` | `{ name, message }` or `null` |
| `idCorrect` | boolean or `null`. Recorded, not used by the decision |
| `workaroundOk` | boolean. The parsing rule applied after one outer fence is removed (FR-1304a) |
| `latencyMs` | the `prompt()`/`promptStreaming()` call duration |
| `fallbackNeeded` | boolean: `category !== 'ok'`, meaning a consumer would have needed a fallback request (FR-1302) |

## Arm summary

For each measured arm: `attempts` (30), counts per `category`, `parseFailures` (every category
except `ok`, and excluding `provider_error`), `providerErrors` by name, `fallbackCount` (attempts with
`fallbackNeeded`), the latency median, min and max, and `workaroundRecovered` (control only).

## Boundary decision

| Field | Values |
|---|---|
| `r1` | `material improvement` \| `no material improvement` \| `failure not reproduced` \| `BLOCKED` |
| `workaroundSufficient` | boolean (FR-1304a) |
| `r3` | per provider: `A` \| `B` \| `C` \| `D`, with a reason |
| `outcome` | `NO_CHANGE` \| `INTERNAL_ONLY` \| `PUBLIC_MINIMAL_EXTENSION` |
| `criterion` | the FR-1310 clause that selected the outcome |
| `capability` | only for PUBLIC_MINIMAL_EXTENSION: a provider-neutral description, per-provider meaning (FR-1313), and ownership semantics (FR-1330) |

Validation rules:
- `outcome` is PUBLIC_MINIMAL_EXTENSION only if `r1 === 'material improvement'`,
  `workaroundSufficient === false`, some provider has `r3` A or B, and R4 to R7 raise no conflict.
- `r1 === 'BLOCKED'` forces NO_CHANGE for this feature. The record says it was blocked, not "no
  benefit".
