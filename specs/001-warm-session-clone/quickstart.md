# Quickstart & Validation: Warm Base Session with Cloned Task Execution

API reference: [contracts/public-api.md](contracts/public-api.md). Entities and states:
[data-model.md](data-model.md).

## Prerequisites

- Node.js ≥ 22.18 or ≥ 23.6 (native TypeScript type stripping) and npm.
- For the benchmark: desktop Chrome with the Prompt API available and the on-device model
  already downloaded (`await LanguageModel.availability()` returns `"available"`).

## Setup

```bash
npm install
npm run build
```

## 1. Unit validation (no browser, fake model)

```bash
npm test
```

Expected: all tests pass. Coverage maps to the spec:

| Scenario | Spec |
|---|---|
| Each task clones, base never prompted, clone destroyed on success | US1, FR-002–FR-005 |
| Task B sees none of task A's context (fake records prompts per session) | US1, SC-004 |
| Abort before submit / while waiting / cloning / prompting → `cancelled`, no leaked session | US2, FR-006, FR-007, FR-010e |
| `AbortSignal.timeout` during clone and during prompt → `cancelled`, `cause.name === 'TimeoutError'`, clone destroyed, partial timing | US2, FR-006, FR-009a, constitution quality gate |
| Clone race: (A) clone rejects `AbortError`; (B) clone resolves after abort → destroyed, never prompted | US2, edge cases |
| One signal reused by 50 queued tasks that start, get rejected, or are drained → 0 listeners left | FR-010e |
| Prompt failure → `failed` with original `cause`, clone destroyed | US2, FR-008 |
| Partial timing: unreached fields absent | FR-009a |
| limit 2 / queue 1 / 5 long tasks → 2 run, 1 waits, 2 rejected; running never > 2 | US4, FR-010a–c, FR-010e–g |
| Defaults 1 / 32 / reject; invalid config rejects | FR-010g, edge cases |
| Clone `InvalidStateError` → `broken`; waiters and later runs rejected | FR-011a/b |
| limit 2: A prompting, B's clone throws `InvalidStateError` → B `broken`, state `broken`, queued/new rejected, A resolves successfully; then shutdown with A still running → A `cancelled` (variant) | FR-011a, edge cases |
| Shutdown cancels running, rejects waiting, destroys all | US5, FR-011 |
| Shutdown twice sequentially, twice concurrently, after `broken` → same promise, no error, destroy counts unchanged | FR-011c |
| 100 mixed tasks → live session count 0 | SC-003 |
| 100-task burst → running tasks never exceed limit, every task settles | SC-006 |

## 2. Benchmark (real browser, real model)

```bash
npm run build
python3 -m http.server 8080
```

Open `http://localhost:8080/bench/` in Chrome and press **Run**.

Expected output (JSON on the page):

- `config`: prompts, iterations (default 30), warmup (default 3), session options.
- `env`: user agent, browser brands/versions, `hardwareConcurrency`, `deviceMemory`.
- `cold`: create, prompt, total. `warm`: baseCreate (single value, one-time), acquire,
  prompt, steady-state total, overhead (`total − queueWait − acquire − prompt`), and
  amortized total at N = 1, 10, 30. Distributions report min / median / mean / p95 / max.
  See [research.md R8](research.md) for the full list.

Pass criteria:

- **SC-001**: `warm.acquire.median × 10 ≤ cold.create.median`, with `warm.baseCreate`
  shown in the same report.
- Wording check: any summary states that initialization is **amortized** over repeated
  tasks, not eliminated.
- **SC-002**: `warm.overhead.median < 1` ms.
- **SC-005**: rerun without code changes yields a report with both paths.

Save the JSON under `bench/results/` with the date and device name for reproducibility
(Principle III).
