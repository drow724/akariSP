# Benchmark: cold vs warm

Compares, on the same prompts and session options:

- **cold**: `LanguageModel.create → prompt → destroy` per task
- **warm**: `createRuntime` once (**baseCreate**, a one-time startup cost; measured after one
  discarded `create → destroy` that loads the model, so it excludes model load), then
  `runtime.run` per task (`clone → prompt → destroy`)

AkariSP **amortizes** session initialization across repeated tasks. It does not eliminate it:
the warm path still pays `baseCreate` once, and `warm.amortizedTotal` shows the per-task cost
including it for N = 1, 10, 30 tasks. Summaries of results must use this framing.

## Run

Prerequisites: desktop Chrome with the Prompt API available and the model downloaded
(`await LanguageModel.availability()` returns `"available"`).

```bash
npm run build
python3 -m http.server 8080
```

Open `http://localhost:8080/bench/` and press **Run** (defaults: 3 warmup + 30 measured
iterations, paths interleaved). Edit `SESSION` / `PROMPTS` in `bench.js` to use another workload.

## Output

- `cold`: `create`, `prompt`, `total`
- `warm`: `baseCreate` (single value), `acquire`, `prompt`, `total` (steady state), `queueWait`,
  `overhead` (`total − queueWait − acquire − prompt`), `amortizedTotal`
- Distributions: `min`, `median`, `mean`, `p95`, `max`; plus `env` and `config`

## Pass criteria

- **SC-001**: `warm.acquire.median × 10 ≤ cold.create.median`, with `warm.baseCreate` reported.
- **SC-002**: `warm.overhead.median < 1` ms.

## Results

Save each run as `bench/results/YYYY-MM-DD-<device>.json` and record it below.

| Date | Device | Browser | SC-001 | SC-002 | File |
|---|---|---|---|---|---|
| 2026-09-26 | macOS, 8 cores, 16 GB | Chrome 152 | ✅ acquire 0.20 ms vs create 206.6 ms (median) | ✅ overhead 0.00 ms median, 0.10 ms p95 | [2026-09-26-macos-8c-16gb-chrome152-preload.json](results/2026-09-26-macos-8c-16gb-chrome152-preload.json) |
| 2026-09-26 (superseded) | same | Chrome 152 | ✅ | ✅ | [2026-09-26-macos-8c-16gb-chrome152.json](results/2026-09-26-macos-8c-16gb-chrome152.json) — `baseCreate` included model load (run before the preload fix); ignore its `amortizedTotal` |

Reading the preload run: base creation (170 ms) costs about one cold create (206.6 ms median),
and each warm task then pays a ~0.2 ms clone instead. Warm steady-state total is 796 ms vs
980 ms cold (median); including the one-time base creation, the warm mean per task is 962 ms
at N = 1, 863 ms at N = 10, and 907 ms at N = 30, vs a cold mean of 1112 ms. Prompt time
dominates and varies widely (p95 ≈ 1.55 s on both paths).
