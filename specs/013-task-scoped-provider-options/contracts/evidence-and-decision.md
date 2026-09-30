# Contract: Evidence and Decision

This feature exposes no new public interface in Stages 1 and 2. Its contract is the evidence record
and the gate that turns it into an outcome.

## Unchanged public contract (Stages 1–2)

- `api/akarisp.api.txt` is byte-identical.
- The `akarisp` and `akarisp/webllm` exports are unchanged.
- `run(input, { signal?, template? })` and `stream(input, { signal?, template? })` behave exactly as
  specified by 001–011.

## Evidence record

- **Location**: `experiments/structured-output/results/<browser>-<date>-run-NN.json`, saved exactly
  as copied from the page.
- **Content**: `environment`, `protocol` (prompt, inputs, schema, parsing rule version, workaround
  rule, order, sample), `attempts[]` (data-model.md: Attempt), and `summary` per arm (Arm summary).
- **Integrity**: attempts are never removed or edited. A failed page run is kept and labelled, not
  discarded.

## Decision gates (FR-1304, FR-1304a, FR-1310, FR-1313)

The checks run in this order; the first matching gate decides:

| # | Gate | Outcome |
|---|---|---|
| 1 | Real browser unavailable | `r1 = BLOCKED` → NO_CHANGE (recorded as blocked) |
| 2 | Control has 0 parse failures | `failure not reproduced` → NO_CHANGE |
| 3 | FR-1304 not met | `no material improvement` → NO_CHANGE |
| 4 | Workaround recovers every control failure (FR-1304a) | NO_CHANGE |
| 5 | Every public provider is R3 class C or D | NO_CHANGE; the existing path is documented |
| 6 | R4 has no provider-neutral candidate, or the public API cost exceeds the demonstrated value | NO_CHANGE (FR-1310) |
| 7 | Only an adapter-internal need remains | INTERNAL_ONLY |
| 8 | Otherwise: some provider is R3 A or B, R4 has a neutral candidate, R5–R7 raise no conflict | PUBLIC_MINIMAL_EXTENSION → plan amendment before any `src/` change |

## If the outcome is PUBLIC_MINIMAL_EXTENSION (not pre-committed)

The plan amendment must provide:
- the chosen R4 shape and the public API snapshot diff;
- the meaning of the new capability for each other provider: ignored, rejected, or forwarded
  (FR-1313);
- ownership semantics (FR-1330);
- tests for FR-1320 items 1 to 10 and for SC-1303, SC-1304 and SC-1305.
