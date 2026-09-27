# Data Model: Framework Compatibility Validation

## Environment (committed fixture)

| Field | Value |
|---|---|
| `id` | `react-vite` \| `vue-vite` \| `svelte-vite` \| `next` |
| path | `fixtures/<id>/` with `package.json` and `package-lock.json` |
| `akarisp` | exactly `0.1.0-alpha.1`, from the registry (FR-1002) |
| framework and tool versions | exact pins (research F3) |
| owner pattern | `straightforward`, or `fixed` if R2 shows it is needed |

## Stand-in counters (`globalThis.__akari`, automated runs only)

| Counter | Increments on | Balance rule |
|---|---|---|
| `creates` / `destroys` | `LanguageModel.create()` / base `destroy()` | equal after the ownership sequence, so every runtime was shut down |
| `clones` / `cloneDestroys` | `base.clone()` / task `destroy()` | equal, so every task was cleaned up, including a stream cut off by unmount |

## Result record (`fixtures/results/*.json`)

| Field | Content |
|---|---|
| `environment`, `akarisp`, `versions`, `date`, `mode` | `mode`: `automated` (stand-in, production) or `manual` (development, real provider) |
| `install`, `dev`, `build`, `serve`, `browser` | `PASS` \| `FAIL` \| `BLOCKED` \| `SKIPPED`, each with a reason |
| `ownership` | `{ cycles, creates, shutdowns, baseCreates, baseDestroys, clones, cloneDestroys }` |
| `devBehaviors` | `{ doubleMount, hmr }`: observed create/shutdown counts and any leak (manual) |
| `next` | `{ ssrError, serverCreates, navigation, serverImport, serverCreate }` (Next.js only) |
| `observations` | free text, framework-specific |
| `final` | `PASS` \| `FAIL` \| `BLOCKED` |

## Ecosystem conclusion (in `research.md`)

One of the following, with cited result records (FR-1018):
- `existing API sufficient`
- `documentation sufficient`
- `candidate future feature`
- `candidate core feature`
