# Data Model: Prompt API Runtime Creation Failure Validation

No product data model changes. The only entity is the evidence record from spec.md.

## Creation failure record

| Field | Values |
|---|---|
| `condition` | `absent` \| `invalid-options` \| `provider-rejection` \| `partial-templates` \| `available` |
| `reportedAs` | `rejection` (a synchronous throw would violate FR-1103) |
| `error` | type, name, message |
| `translated` | `false` required. Object identity may be noted as regression evidence |
| `isTaskError` | `false` required |
| `resourcesLeft` | `0` required |
| `source` | `real browser` \| `stand-in` \| `unit test (Node)` |

Where each record lives:
- Unit tests (research.md R1) cover all conditions.
- The pre-feature `results-2026-09-27.json` covers `absent`, `provider-rejection`, and
  `available` for the published package in Node and Chromium.
