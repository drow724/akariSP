# Quickstart & Validation: Named Session Templates

API: [contracts/public-api.md](contracts/public-api.md). Rules:
[data-model.md](data-model.md).

## Usage

```js
const runtime = await createRuntime({
  templates: {
    momentum: { initialPrompts: [{ role: 'system', content: 'You analyze momentum.' }] },
    risk: { initialPrompts: [{ role: 'system', content: 'You analyze risk.' }] },
  },
  limit: 2,
});

await runtime.run(snapshotText, { template: 'momentum' });
for await (const chunk of runtime.stream(snapshotText, { template: 'risk' })) render(chunk);
await runtime.shutdown(); // destroys both bases
```

## Validation

```bash
npm test
```

All 001–003 tests pass unchanged (SC-306), plus these tests with the existing fake
`LanguageModel`. Per-call create failures are simulated by wrapping `LanguageModel.create`
inside the test; the fake itself is unchanged.

| Scenario | Spec |
|---|---|
| Templates a/b with distinct `initialPrompts`: each task's clone history starts with its own template only; base histories unchanged | US1, SC-302 |
| Streaming with `{ template }` clones that template's base | US1/AC3 |
| `limit: 2`, held tasks on 2 templates + 1 on a third → snapshot 2 active / 1 queued; FIFO across templates | US2, FR-305 |
| Lazy stream with a template: no clone, counts unchanged | US2/AC3, FR-306 |
| Unknown template on `run` / at stream first pull → `TypeError`; snapshot and clone count unchanged | US3, SC-304 |
| Templates without `session`, no template named → `TypeError`, nothing consumed | US4/AC3, FR-313 |
| `session` + templates: unnamed task uses the default base; named task uses its template | US4/AC2 |
| `{ templates: {} }` without `session` → `TypeError`, 0 creates | FR-308 |
| Second template's `create()` rejects → same error, first base destroyed | FR-309 |
| Clone `InvalidStateError` on template a → runtime broken; running task on b finishes; later tasks on b refused | US5/AC3, FR-311 |
| Shutdown with 3 templates → each base destroyed exactly once, `live === 0`; repeated/concurrent shutdown unchanged | US5/AC1, SC-305 |
| Burst of 100 tasks across 3 templates → running ≤ limit, queued ≤ capacity, all settle | SC-303 |

No benchmark change: no performance claim (Constitution III).
