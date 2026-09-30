# Research: Task-Scoped Provider Options Boundary Validation

Evidence labels (FR-1342): **CONTRACT** (documented contract), **IMPL** (implementation behavior),
**OBS** (experimental observation), **HYP** (hypothesis). Sources were read on 2026-09-30.

## R2. Scope of the capability

- **Prompt API specification** (CONTRACT, `webmachinelearning/prompt-api` `9fcb9a4`, 2026-09-24,
  the current `main`):
  - `responseConstraint` and `omitResponseConstraintInput` are members of
    `LanguageModelPromptOptions` only. That dictionary is used by `prompt()`, `promptStreaming()`
    and `measureContextUsage()`.
  - Neither member is in `LanguageModelCreateCoreOptions` or `LanguageModelCreateOptions`, nor in
    `LanguageModelCloneOptions`.
  - The constraint is an `object`. The generation step "should use" it "to guide the model's
    behavior". **The spec does not guarantee that the output conforms.**
  - `omitResponseConstraintInput: true` without a constraint throws `TypeError` in
    `measureContextUsage()`.
- **Chrome documentation** (CONTRACT, "Structured output for the Prompt API", updated 2025-05-13):
  - A JSON Schema is passed in the options of `prompt()` or `promptStreaming()` as
    `responseConstraint`, not to `create()`.
  - Available as of Chrome 137.
  - No conformance guarantee is stated.
- **Prompt API explainer** (CONTRACT, the repository `README.md` at `9fcb9a4`, read 2026-09-30,
  added after the run): `responseConstraint` accepts either a JSON Schema object **or a `RegExp`**.
  - The returned value "will be a string that matches" the RegExp. If the user agent cannot
    produce a matching response, the method errors with a `SyntaxError` `DOMException`. Any other
    value is a `TypeError`.
  - The IDL type is only `object`, so the specification body alone does not reveal this.
  - Chrome 153 behavior was observed later; see "RegExp follow-up" in the decision record.
- **Conclusion (CONTRACT)**: the constraint is **prompt-scoped** on both the prompt and the
  streaming path. Whether Chrome also honours it when it is placed in creation options is **not**
  in any contract. The creation-scope check in the R1 protocol observes it (OBS, pending).

## R3. Narrowest gap, per provider (preliminary; final after R1)

| Provider | What exists today | Class (preliminary) |
|---|---|---|
| Prompt API | Creation options reach `LanguageModel.create()` unchanged, but the constraint is not a creation option (R2). AkariSP prompts each task with `{ signal }` only (IMPL, `src/core/runtime.ts`; `src/browser/runtime.ts` passes `start` = `clone`). No public path reaches a prompt option | **A or B**, pending the creation-scope check |
| WebLLM 0.2.85 | A template is request configuration spread into every request: `{ ...settings, messages, stream: true }` (IMPL, `src/webllm/runtime.ts`; 007 E9). `ChatCompletionRequest.response_format` supports `json_object` with a `schema` string, `grammar`, and `structural_tag` (CONTRACT, the package's `chat_completion.d.ts`) | **C at template granularity**: one fixed template per schema. Per-task variation is not expressible |

A versus B:
- **A**: only the structured-output constraint is missing.
- **B**: any prompt-scoped option is missing.

The evidence at hand motivates A only. Because the Prompt API prompt options also include
`omitResponseConstraintInput` and `signal` (already owned by AkariSP), the distinction matters for
R4. Final classification follows R1.

## R4. Candidate boundary shapes (compared, not selected)

| Candidate | Provider-neutral description | Observations |
|---|---|---|
| a. Opaque per-task options object forwarded to the provider's task start and prompt call | "Provider options for this task, passed unchanged" | Mirrors the existing creation passthrough (005, 011: "passed unchanged", core never inspects). Untyped like `session` (audit B). Merge rule with AkariSP's own `signal` must be defined |
| b. Generic typed runtime (`Runtime<TaskOptions>`) per entry point | Same, with the provider entry point fixing the type | Better DX. Changes the shape of the public `Runtime` type and the API snapshot more broadly (FR-1322 risk) |
| c. Provider-specific option only on the Prompt API entry point | Not neutral: it names the provider's concept | Violates SC-1302 unless the core type stays unchanged and the option lives outside it. That is closer to INTERNAL_ONLY |

Selection happens only in a plan amendment, and only if the outcome is PUBLIC_MINIMAL_EXTENSION.

## R5. WebLLM implications

- **Request-scoped options** (CONTRACT, 0.2.85 types): `response_format`, sampling parameters,
  and others.
- **Current exposure** (IMPL): any template field is forwarded to every request of that template.
  Structured output is therefore available per template today.
- **Conflict risk**: a per-task path would need a precedence rule against the template's settings.
  Otherwise the same field could come from two places with undefined results. This makes it a
  template-bypass question (R6), not only a typing question.
- **Leak risk**: with candidate b, WebLLM's `ChatCompletionRequest` fields would appear in a public
  type. Candidate a leaks nothing but is untyped.
- **No symmetry features** (FR-1308): if the Prompt API gap is the only driver, the WebLLM meaning
  is stated rather than extended (FR-1313).

## R6. Fixed-template semantics

- **A per-call object**: an option that AkariSP forwards for one call and never stores
  parameterizes one execution. It does not create, mutate, or cache a template, so 004 FR-301,
  FR-302 and FR-315 hold (HYP, to be confirmed by the ownership semantics).
- **Where the risk lies**: a per-task field that overrides a template field (WebLLM) is a
  per-execution override of template content. If allowed, it must be documented as such. It
  must never write back into the template.

## R7. run() and stream()

The Prompt API specification and the Chrome documentation both accept the constraint on
`prompt()` and `promptStreaming()` (CONTRACT). WebLLM requests are always streaming in the adapter
(IMPL). No provider limitation that would justify asymmetry is known. The streaming check in the
R1 protocol observes whether Chrome accepts it (OBS, pending).

## R1. Fixed protocol (written before measurement)

- **Environment**: desktop Chrome with `LanguageModel.availability() === 'available'`. The page
  refuses otherwise.
- **Base**: one `LanguageModel.create({ initialPrompts: [{ role: 'system', content: 'You are a
  precise data extraction assistant.' }] })`. Each attempt runs `clone()` → `prompt()` →
  `destroy()`, which mirrors AkariSP's per-task clone. A 60 s timeout per attempt uses a
  time-based signal.
- **Inputs** (cycled in order):
  1. `Invoice 48213 for the blue desk was paid on Monday.`
  2. `Please ship order 70516 to the Lisbon office.`
  3. `Ticket 3390 was closed after the customer replied.`
  4. `Room 1207 is booked for the design review.`
  5. `Package 885104 left the warehouse this morning.`
- **Prompt** (identical in both arms):

  ```text
  Extract the numeric identifier from the text below. Respond with a JSON object of the form
  {"id": "<digits>"} and nothing else.

  Text: <input>
  ```

- **Treatment**: the same prompt with the option `responseConstraint` set to the schema below.
  `omitResponseConstraintInput` stays at its default (`false`).

  ```json
  {"type":"object","properties":{"id":{"type":"string","pattern":"^[0-9]+$"}},"required":["id"],"additionalProperties":false}
  ```

- **Parsing rule** (applied to both arms): `s = output.trim()`. It is a success only if
  `JSON.parse(s)` succeeds and the value is a plain object with exactly one key `id`, whose value is
  a string of one or more digits. Whether `id` equals the expected identifier is recorded as
  `idCorrect` and is **not** part of the decision (no semantic scoring).
- **Failure categories** (first match wins):
  - `provider_error`: the call rejected; name and message are recorded.
  - `empty`: `s === ''`.
  - `fence`: `s` starts with three backticks.
  - `not_json`: `JSON.parse` failed.
  - `schema_mismatch`: parsed, but the shape is wrong.
- **Workaround rule** (FR-1304a, analysis only): if `s` matches one outer fence (three backticks,
  an optional language tag, the content, then three closing backticks), apply the parsing rule to
  the content. Otherwise apply it to `s`.
- **Order and sample**: 3 warmup attempts per arm (excluded), then 30 measured attempts per arm.
  The arms are interleaved as ABBA per pair of rounds, so neither arm always runs first.
- **Decision rule**: FR-1304 as clarified. The result is exactly one of "material improvement",
  "no material improvement", or "failure not reproduced".
- **Supplementary checks** (exploratory OBS, not part of FR-1304):
  - **Creation scope**: 10 attempts on a second base created with the schema placed in the
    creation options as `responseConstraint` (not a dictionary member, so it may be ignored),
    prompted without a constraint.
  - **Streaming**: 5 attempts of `promptStreaming()` with the constraint. Record errors and apply
    the parsing rule to the joined chunks.
- **Recorded metadata**: browser full version, OS and platform version, availability, repetitions,
  constraint, prompt, parsing rule version, and date.

## Decision record

Run: `experiments/structured-output/results/chrome-153-2026-09-29-run-01.json`.
- Environment: Chrome 153.0.8010.53, macOS 15.7.4 (arm), 8 cores, 16 GB, availability `available`.
- The maintainer ran it; the result was saved unchanged from the clipboard.
- Summaries and `r1`, recomputed from `attempts[]` with `rules.js`, match the page's own output,
  including every category and `workaroundOk` value.

### R1 (OBS; one browser, one device, one workload)

| Arm (30 measured) | ok | fence | not_json | schema_mismatch | empty | provider errors | fallback | latency median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| control (prompt-only) | 25 | 5 | 0 | 0 | 0 | 0 | 5 | 565 ms |
| treatment (native constraint) | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 731 ms |

- **Result**: `material improvement` (FR-1304). The control reproduced the consumer's failure class
  5 times (every failure was a ```` ```json ```` fence around a correct object). The treatment had
  0 parse failures, 0 fences, and no new error.
- **Distribution**: the control fences appeared in rounds 13, 14, 15, 24 and 25. The failures were
  clustered, not uniform. No rate claim is made.
- **Latency**: the treatment median was about 165 ms higher than the control's. This is descriptive
  only; no latency claim is made.
- **Semantic check**: `idCorrect` was never false in any attempt. It is recorded but not used in the
  decision.

### Workaround check (FR-1304a)

`workaroundRecovered` = 5 of 5 control parse failures: removing one outer fence recovers every
failure. **The workaround is sufficient.**

### Supplementary observations (OBS, exploratory, not part of FR-1304)

- **Creation scope**: 10 attempts on a base created with `responseConstraint` among the creation
  options gave 10 `ok` and 0 errors. The unknown creation member was accepted silently.
  - **This is inconclusive about scope.** At the control's observed rate (5/30), 10 unconstrained
    attempts with no fence would have about a 16% chance ((25/30)^10), so 10 clean attempts do not
    show that a creation-time constraint has any effect.
  - The contract (R2) still says the constraint is prompt-scoped.
- **Streaming**: 5 of 5 `promptStreaming()` calls with the constraint were `ok`, with no error.
  Chrome accepts the constraint on the streaming path (consistent with R7).

### R3 per provider (final)

| Provider | Class | Reason |
|---|---|---|
| Prompt API | **A** | The only prompt-scoped option motivated by evidence is the structured-output constraint. No public AkariSP path reaches a prompt option (CONTRACT R2, IMPL). The creation-scope observation does not change this, because it is inconclusive |
| WebLLM 0.2.85 | **C** at template granularity | `response_format` in a template reaches every request of that template (IMPL, CONTRACT). This is not re-measured here |

### Outcome

- **Outcome: NO_CHANGE.**
- **Deciding gate: 4** (contracts/evidence-and-decision.md). FR-1310 clause: "the workaround is
  sufficient by FR-1304a".
- The earlier gates did not decide:
  - gate 1: not BLOCKED;
  - gate 2: the control reproduced the failure;
  - gate 3: the FR-1304 improvement is met.
- Gates 5 to 8 are not reached. The Prompt API remains R3 class A, so without gate 4 the decision
  would have gone to review against R4.
- Consequences:
  - `src/`, the public API, tests, README and dependencies are unchanged (FR-1311, SC-1306).
  - No ownership semantics are needed (FR-1330 applies only to an extension).

What this does **not** say:
- It does not say the native constraint is useless. It removed every fence in this run.
- It does not say the workaround is always enough. Only the fence failure class was observed; the
  control had no `not_json` or `schema_mismatch` failure.
- R1 measured only one JSON Schema. A RegExp workload whose violations are not all repairable
  after the fact (for example "no bare digits") may not meet gate 4. That is revisit condition 2, checked
  below.

### RegExp follow-up (revisit condition 2, 2026-09-30)

A separate run, `experiments/structured-output/results/chrome-153-2026-09-30-regexp-run-01.json`,
used the same environment as R1 (Chrome 153.0.8010.53, macOS 15.7.4 arm).
- **Workload**: two labelled numbers per prompt. The prompt says to write no digits and to refer to
  values only as `{D1}` or `{D2}`.
- **Treatment**: adds `responseConstraint: /^([^0-9{}]|\{D[0-9]+\})*$/`.
- **Violation**: a digit outside a `{D<n>}` token (`regexp-rules.js` v1). No workaround was
  defined for this run. That does not make every violation unrepairable:
  - A bare number equal to exactly one known value could be mapped back to that value.
  - Only numbers that were rounded, computed or invented, or that match more than one value, lose
    their meaning.
- **Design**: 3 warmup and 30 measured attempts per arm, ABBA.
- **Verification**: recomputing every category from `attempts[]` gives 0 mismatches.

| Question | Result | Label |
|---|---|---|
| Does Chrome accept a `RegExp`? | Yes. `/^(yes\|no)$/` returned `yes` with no error. The prompt also asked for yes or no, so this shows acceptance, not enforcement. | OBS |
| Does Chrome reject a non-object value? | `42` threw `TypeError` during the options conversion, in 3 ms. | OBS |
| Does the control reproduce bare digits? | **No: 0/30** (0/3 in warmup). Every control output also matched the treatment RegExp. | OBS |
| Does the treatment reach 0, and at what cost? | 0/30 violations and no errors. `SyntaxError` was never seen. <br>Latency median: 2339 ms vs 2162 ms; paired ratio median 1.07×; the treatment was slower in 20/30 pairs. <br>Median output length: 88 vs 90.5 characters. <br>1 `no_ref` answer ("Revenue is significantly higher than refunds.") dropped both references. | OBS |
| What are the limits of RegExp forms? | A lookahead `/^(?![\s\S]*[0-9])[\s\S]*$/` was rejected 3/3 with `NotSupportedError` ("The request is invalid"), asynchronously after 0.6–1.0 s. It did not throw `SyntaxError` or `TypeError`. A negated class with alternation and `*`, as in the treatment, was accepted. | OBS |

- **Gate**: this workload stops at **gate 2** (the control did not reproduce the failure), so it gives
  no reason to change the NO_CHANGE outcome.
- **Why the model obeyed the prompt**: this is a hypothesis and was not examined. The task may be
  too easy, or `{D1}`-style templating may suit this model.

#### First consumer report: BrowserTradingAgents 013 (EXTERNAL, provisional, not reproduced here)

BTA feature 013 ("numbers by reference", branch `013-numbers-by-reference`, uncommitted) reproduced
the failure with the prompt only.

**Setup**
- Chrome Prompt API on the same Mac, used through `akarisp@0.1.0-alpha.2` with no AkariSP change.
- No `responseConstraint`: AkariSP has no public path for it (BTA finding F-A).
- The final role of an 8-role pipeline answers 25 Korean portfolio questions, 6 of them traps,
  per holding. That gives 33 answers per repetition, and there were 3 repetitions.
- **Input**: the facts carry a label after each number, for example `91,250,000 KRW {D1b}`.
- **Instruction**: `REFS_ANSWER` in BTA `src/graph/trading-graph.ts`.

**Violation rule** (BTA `src/analysis/references.ts`)
- A number outside a reference. Numbers from the question are allowed, and counts ≤ 10 are
  never extracted.
- An unknown reference.
- A label written without braces.

**Results**
- Answers with at least one violation: 81.8%, 69.7% and 84.8%, about 78 of 99. BTA reports these
  numbers as still being measured.
- In BTA's hand audit of 20 answers (`evidence/hand-audit-refs.json`), 16 have a violation. Only 1
  holds a wrong number, and that one is a wrong reference (`{M1b}` for a 27.4% rise).
- The hand audit names these failure types:
  1. value and reference both written;
  2. a bare number;
  3. several labels in one pair of braces, such as `{M1a, D2}`;
  4. a wrong reference.
- Per-type counts are not recorded.

**Assessment for this decision**
- This is the consumer case that R1 lacked for this failure class, and it reaches gate 2.
- It is a **candidate** for revisit condition 2, not a met condition.
- Condition 2 needs a rerun of this protocol (control against constraint) that lands on a
  different gate.
- Gate 4 remains open:
  - Type 1 can plausibly be repaired: drop a bare number equal to an adjacent reference's value.
  - Type 3 can plausibly be repaired: split the braces.
  - Type 2 can be repaired when the number equals exactly one known value.
  - A constraint cannot prevent type 4.
- A rerun therefore has to count violations by type and by whether they can be repaired.

#### Consumer-workload rerun: fixed protocol (written 2026-09-30 before any capture was seen)

This protocol is fixed before the prompt set, the capture and any rerun output exist.

**Scope and inputs**
- The research is a rerun of R1's control-against-constraint comparison on the BTA workload.
- The prompt set comes from BTA `scripts/harness-prompts.ts`: file `harness-prompts-refs.json`.
  - It has 33 `items`, in the order of repetition 1 (25 questions × holdings).
  - Each item has `finalPrompt`, `questionText` and `refs[]` (`name`, `factId`, `shown`).
  - The three upstream slots are filled from BTA's native capture.
  - The file is copied unchanged to `experiments/structured-output/inputs/`, and its sha1 is
    recorded.
- The capture's own `finalDecision` answers are prompt-only outputs. They are **not** used for
  any gate and are only reported as a separate observation.

**Session conditions**
- The conditions match the app: the default Prompt API template has no creation options and no
  `initialPrompts`, and each attempt sends one message, `[{ role: 'user', content: finalPrompt }]`.
- Differences from the app are recorded, not corrected:
  - one base for the whole run instead of one runtime per graph run;
  - native calls directly instead of AkariSP, which cannot pass the option;
  - no upstream roles run in the same session history.

**Arms and order**
- **control**: no options besides `signal`.
- **treatment**: `responseConstraint: /^([^0-9{}]|\{[A-Z][0-9]+[a-z]?\})*$/`.
- 3 warmup attempts per arm on items 0–2 are not counted. Then each of the 33 items runs once per
  arm, ABBA over pairs of items.
- The timeout is 120 s per attempt, and a timeout is a provider error.
- Nothing is retried, and there is no second run unless the first is BLOCKED.

**Violation rule v1** (`refs-rules.js`), applied to the raw output
- **Numbers**:
  - A number is `\d[\d,]*(\.\d+)?`, optionally followed by `억` (×10⁸) or `만` (×10⁴).
  - Adjacent tokens with falling units, separated only by spaces, are summed, so `6만 5,320`
    is 65,320.
  - `YYYY-MM-DD` is one date token.
  - Values are compared as absolute values.
  - Ref values are parsed from `shown` with the same parser.
- **Exempt**:
  - numbers whose value appears in `questionText`;
  - integers ≤ 10 with no `%`, `억` or `만`, following BTA's "counts ≤ 10 are never extracted".
- **Braced reference**: `\{\s*[A-Za-z]\d+[A-Za-z]?\s*\}`, normalized as BTA does (upper letter,
  lower suffix).

**Violation types** (first match per span)

| Type | Rule | Repairable |
|---|---|---|
| `combined` (type 3) | braces holding two or more label-like names separated by `,` | yes if every name is known |
| `unknown_ref` | a braced name not in `refs` | no |
| `unbraced` | a known name outside braces | yes |
| `duplicate` (type 1) | a non-exempt number whose value equals a braced reference within 12 characters that hold no other digit | yes (delete it) |
| `bare` (type 2) | any other non-exempt number | yes only if every ref with that value has the same `shown`; otherwise no, including rounded, computed or invented numbers |

- Type 4 (wrong reference) is semantic and is not counted automatically. It is reported only from
  a hand audit, labelled as such.

**Per-arm metrics**
- answers with ≥ 1 violation;
- answers with ≥ 1 **unrepairable** violation;
- counts per type;
- provider error names;
- `no_ref` answers (no reference at all);
- latency median and output-length median.

**Gates** (same order as contracts/evidence-and-decision.md)
1. **BLOCKED**: availability is not `available`, or the run aborted.
2. **Not reproduced**: control answers with ≥ 1 violation = 0 → NO_CHANGE.
3. **FR-1304 analogue**. Let c be the number of control answers with a violation. This gate is met
   when all of the following hold:
   - treatment answers with a violation ≤ ⌊c/2⌋;
   - no new provider error names in the treatment (`SyntaxError` counts as new);
   - failing it → NO_CHANGE.
4. **Workaround**: control answers with an unrepairable violation = 0 → NO_CHANGE.
5. Otherwise → REQUIRES_REVIEW against gates 5–8. There is no automatic API change.

**Known differences from BTA's rule, recorded rather than resolved**
- The treatment RegExp also forbids the exempt numbers and dates, and lowercase or spaced labels.
- The number parser is simpler than BTA `claims()`.
- **Not covered**:
  - This is one workload, one device and one run.
  - Chrome's supported RegExp subset was not mapped beyond the two forms above.
  - `promptStreaming()` was not tested with a RegExp.
  - Whether the lookahead rejection comes from the Prompt API or from the model backend is not
    known; the error text does not say.

### Revisit conditions

1. A consumer or a rerun shows control failures that one-fence removal does not recover, for
   example prose around the JSON, wrong shape, or a truncated object.
2. The workload changes materially, for example larger or nested schemas or a regular-expression
   constraint, and a rerun of this protocol gives a different gate.
3. A browser version or model update changes the control's failure classes.
4. A supported provider appears whose structured output cannot be expressed through creation
   options or templates, and the workaround does not apply.

## Deferred and separate

These findings are not changed by this feature (FR-1341):
- error taxonomy for context overflow;
- runtime identity;
- tool-call visibility;
- native broken-state classification (012, DEFER).

## Implementation evidence

- **T001 baseline (2026-09-30, `main` `5b794d8`)**:
  - `npm test`: 146/146
  - `npx tsc --noEmit`: pass
  - `npm run test:browser`: 21/21
  - `api/akarisp.api.txt` sha1: `7303ea9f841149b84f181d30d3589548b484d2c9`
- **T003**: `node experiments/structured-output/standin.mjs` prints `stand-in rules: ok`
  (DETERMINISTIC_STAND_IN; calculations only).
- **T006** (built-in browser, fake `LanguageModel`, not evidence, output not saved): the page ran
  6 warmup, 60 measured, 10 creation-scope and 5 streaming attempts in the order
  control/treatment/treatment/control. The summaries match `rules.js`. The fake (fenced control,
  bare treatment) gives `r1 = material improvement`. The second base received
  `responseConstraint` in its creation options.
- **T007**: `results/chrome-153-2026-09-29-run-01.json` was saved from the clipboard. Its date and
  summary match the pasted run. Recomputing from `attempts[]` reproduces every category,
  `workaroundOk`, every summary, and `r1 = material improvement` (quickstart V4).
- **T011 final audit**:
  - `npm test`: 146/146
  - `npx tsc --noEmit`: pass
  - `npm run test:browser`: 21/21
  - `git diff main --stat -- src/ api/ test/ README.md package.json`: empty
  - `api/akarisp.api.txt` sha1: `7303ea9f841149b84f181d30d3589548b484d2c9` (equal to T001)
  - `standin.mjs`: ok
