# Structured output: prompt-only vs native constraint (013)

Researched 2026-09-29/30 for `specs/013-task-scoped-provider-options`.

**Decision: NO_CHANGE** (gate 4). The native constraint removed every Markdown fence. Every fence
the prompt-only arm produced was also recovered by removing one outer fence, so this evidence does
not justify a task-scoped options boundary in AkariSP. `src/` and the public API are unchanged.

## Question

A consumer on `akarisp@0.1.0-alpha.2` sometimes got JSON wrapped in a Markdown code fence. Does the
Prompt API's native task-scoped structured-output constraint materially fix that? If so, must
AkariSP expose a way to pass it per task?

## Evidence classes

Each finding carries a source class and an FR-1342 label.

| Finding | Source class | FR-1342 label |
|---|---|---|
| The constraint is a prompt option (`prompt()`, `promptStreaming()`), not a creation option; the spec says it "should" guide output and gives no conformance guarantee | PLATFORM_SPECIFICATION (`prompt-api` `9fcb9a4`), Chrome docs | documented contract |
| The constraint may also be a `RegExp`; a non-matching response errors with `SyntaxError` | Prompt API explainer (`README.md` at `9fcb9a4`), found after the run | documented contract |
| Chrome 153 accepts a `RegExp`, rejects a lookahead form, and the control did not reproduce bare digits | REAL_BROWSER (RegExp follow-up below) | experimental observation |
| AkariSP prompts each task with `{ signal }` only; WebLLM templates reach every request | SOURCE | implementation behavior |
| R1 counts, workaround recovery, creation-scope and streaming observations | REAL_BROWSER | experimental observation |
| Calculation correctness of `rules.js` | DETERMINISTIC_STAND_IN (`standin.mjs`) | implementation behavior (harness only) |
| Why the fences clustered in some rounds | — | hypothesis (not examined) |

## Protocol

The full protocol, fixed before measurement, is in
[research.md R1](../../specs/013-task-scoped-provider-options/research.md). In summary:
- One base; each attempt is `clone()` → `prompt()` → `destroy()` directly on native sessions.
  AkariSP is not used, because it cannot pass the option.
- 5 fixed inputs and one identical prompt in both arms. The treatment adds `responseConstraint`
  (a JSON Schema: object with a single digit-string `id`).
- 3 warmup and 30 measured attempts per arm, interleaved ABBA. The timeout is 60 s per attempt.
- **Parsing rule (v1)**: the whole trimmed output must `JSON.parse` to an object with exactly one
  key `id`, whose value is a digit string. Failure categories, first match wins:
  `provider_error`, `empty`, `fence`, `not_json`, `schema_mismatch`.
- **Workaround rule** (analysis only): remove one outer fence with an optional language tag, then
  apply the same parsing rule.

## Results (Chrome 153.0.8010.53, macOS 15.7.4 arm, 8 cores / 16 GB)

| Arm | Attempts | ok | fence | not_json | schema_mismatch | empty | Provider errors | Fallback | Latency median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| control (prompt-only) | 30 | 25 | 5 | 0 | 0 | 0 | 0 | 5 | 565 ms |
| treatment (constraint) | 30 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 731 ms |

- **R1 = material improvement** (FR-1304): the control reproduced the failure 5 times; the
  treatment had 0 failures and no new error.
- Every control failure was a ```` ```json ```` fence around a correct object. They appeared in
  rounds 13–15 and 24–25.
- **Workaround**: 5 of 5 control failures were recovered by removing one outer fence, so the
  workaround is sufficient (FR-1304a).
- `idCorrect` was never false.

## Supplementary checks (exploratory)

- **Creation scope**: 10 attempts on a base created with `responseConstraint` in the creation
  options gave 10 `ok` and 0 errors (the unknown member was accepted silently).
  - This is **inconclusive**: with no effect at all, 10 clean attempts would still occur about 16%
    of the time at the control's rate.
- **Streaming**: 5 of 5 `promptStreaming()` calls with the constraint were `ok`.

## Decision

| Gate | Result |
|---|---|
| 1 real browser | available |
| 2 control reproduces | yes (5) |
| 3 FR-1304 | met |
| **4 workaround recovers every control failure** | **yes (5/5) → NO_CHANGE** |

Gates 5–8 were not reached. For the record:
- R3 is **A** for the Prompt API: only the constraint is missing, and no public path reaches a
  prompt option.
- R3 is **C at template granularity** for WebLLM.

## What this does not prove

- One browser, one device, one workload (a single-field object), one run.
- It gives no rate claim and no conformance guarantee: the spec does not promise one.
- The native constraint is not shown to be unnecessary. It removed every fence here.
- The workaround is not shown to cover other failure classes. None were observed.
- R1 used only one JSON Schema. The RegExp follow-up below covers one RegExp workload.

## RegExp follow-up (revisit condition 2)

This run is `results/chrome-153-2026-09-30-regexp-run-01.json`, from `regexp.html`. It used the
same environment.
- **Workload**: two labelled numbers per prompt. The prompt says "Never write any digits" and to
  refer to values only as `{D1}` or `{D2}`.
- **Treatment**: adds `responseConstraint: /^([^0-9{}]|\{D[0-9]+\})*$/`.
- **Violation**: a digit outside `{D<n>}` (`regexp-rules.js` v1). No workaround was defined for
  this run. A bare number equal to exactly one known value could still be mapped back.

| Arm | Attempts | Violations | Errors | `no_ref` | Latency median | Chars median |
|---|---:|---:|---:|---:|---:|---:|
| control (prompt-only) | 30 | **0** | 0 | 0 | 2162 ms | 90.5 |
| treatment (RegExp) | 30 | 0 | 0 | 1 | 2339 ms | 88 |
| lookahead probe | 3 | — | 3 `NotSupportedError` | — | 618 ms | — |

- **Acceptance**: Chrome accepted `/^(yes|no)$/`. `responseConstraint: 42` threw `TypeError`.
- **Cost**: the paired latency ratio median was 1.07×. One treatment answer dropped both
  references. `SyntaxError` was never seen.
- **Limits**: `/^(?![\s\S]*[0-9])[\s\S]*$/` (a lookahead) was rejected every time with
  `NotSupportedError`. A negated class with alternation was accepted.
- **Decision**: the control did not reproduce the failure, so this workload stops at gate 2. NO_CHANGE
  stands.
- **Hypothesis, not examined**: the prompt alone was enough for this task.
- **First consumer report**: BrowserTradingAgents 013. This is an external report that has not
  been reproduced here, and its numbers are provisional.
  - The failure appeared with the prompt only, through AkariSP, with no constraint.
  - About 79% of answers had a violation (about 78 of 99).
  - In BTA's hand audit, most violations repeat a correct value next to its reference. One answer
    has a wrong number, from a wrong reference, which no RegExp can prevent.
  - This is a candidate for revisit condition 2. A rerun must count violations by type and by
    whether they can be repaired. See
    [research.md](../../specs/013-task-scoped-provider-options/research.md), "First consumer report".

## BTA-workload rerun (consumer case)

This run is `results/chrome-153-2026-09-30-refs-run-01.json`, from `refs.html`. It used 33 BTA
final-role prompts from `inputs/`. The protocol was fixed before the run; see research.md,
"Consumer-workload rerun".

| Arm | Answers with a violation | With an unrepairable violation | Degenerated (post-hoc) | Latency median / max |
|---|---:|---:|---:|---|
| control (prompt-only) | 25/33 | 8/33 (4 after removing parser artifacts) | 0 | 4091 / 5730 ms |
| treatment (`/^([^0-9{}]\|\{[A-Z][0-9]+[a-z]?\})*$/`) | 0/33 | 0/33 | 9 | 4516 / 73719 ms |

- The pre-registered gates stop at gate 5 → REQUIRES_REVIEW.
- The review outcome is **NO_CHANGE** (gate 6: cost exceeds value). The maintainer decided it on
  2026-09-30.
  - The treatment's degenerated answers were repetition loops, `₩` placeholders, a truncation and
    an invented non-answer.
  - Wrong amounts moved into spelled-out Korean (2 answers, the same count as the control), and
    one answer used circled digits.

## Revisit conditions

1. Control failures that one-fence removal does not recover, for example prose around the JSON, a
   wrong shape, or truncation.
2. A materially different workload (larger or nested schemas, regular-expression constraints)
   whose rerun lands on a different gate.
3. A browser or model update that changes the control's failure classes.
4. A supported provider whose structured output cannot be expressed through creation options or
   templates, where the workaround does not apply.

## Reproduce

```bash
node experiments/structured-output/standin.mjs   # rules.js calculations only
python3 -m http.server 8080
# Chrome with the Prompt API model available:
# http://localhost:8080/experiments/structured-output/index.html → Run → Copy JSON
# Save unchanged as results/chrome-<major>-<run-date>-run-NN.json
# RegExp follow-up: regexp.html → Run → Copy JSON → results/chrome-<major>-<run-date>-regexp-run-NN.json
# BTA-workload rerun: copy BTA harness-prompts-refs.json unchanged to inputs/, then
# refs.html → Run → Copy JSON → results/chrome-<major>-<run-date>-refs-run-NN.json
```
