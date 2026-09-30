// Research-only (013): REAL_BROWSER R1 comparison, run directly on native task sessions. AkariSP is
// not imported: it cannot pass a prompt-scoped option today (FR-1301). Constants are copied verbatim
// from specs/013-task-scoped-provider-options/research.md R1.
import { PARSING_RULE_VERSION, categorize, workaroundOk, summarize, decideR1 } from './rules.js';

const SYSTEM = { role: 'system', content: 'You are a precise data extraction assistant.' };
const INPUTS = [
  { text: 'Invoice 48213 for the blue desk was paid on Monday.', id: '48213' },
  { text: 'Please ship order 70516 to the Lisbon office.', id: '70516' },
  { text: 'Ticket 3390 was closed after the customer replied.', id: '3390' },
  { text: 'Room 1207 is booked for the design review.', id: '1207' },
  { text: 'Package 885104 left the warehouse this morning.', id: '885104' },
];
const prompt = (text) => 'Extract the numeric identifier from the text below. Respond with a JSON object of the form\n'
  + '{"id": "<digits>"} and nothing else.\n\nText: ' + text;
const SCHEMA = { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]+$' } }, required: ['id'], additionalProperties: false };
const WARMUP = 3, MEASURED = 30, CREATION_SCOPE = 10, STREAMING = 5, TIMEOUT_MS = 60_000;

const $ = (id) => document.getElementById(id);
const log = (s) => { $('log').textContent += s + '\n'; };

async function attempt(base, { phase, arm, round, index, streaming = false, constrained }) {
  const input = INPUTS[round % INPUTS.length];
  const options = { signal: AbortSignal.timeout(TIMEOUT_MS), ...(constrained ? { responseConstraint: SCHEMA } : {}) };
  const clone = await base.clone();
  let output = null, error = null, t0 = 0, t1 = 0;
  try {
    t0 = performance.now();
    if (streaming) {
      output = '';
      for await (const chunk of clone.promptStreaming(prompt(input.text), options)) output += chunk;
    } else {
      output = await clone.prompt(prompt(input.text), options);
    }
  } catch (e) {
    error = { name: e?.name ?? typeof e, message: e?.message ?? String(e) };
    output = null;
  } finally {
    t1 = performance.now();
    clone.destroy();
  }
  const category = categorize(output, error);
  let idCorrect = null;
  if (category === 'ok') idCorrect = JSON.parse(output.trim()).id === input.id;
  const a = { phase, arm, round, index, input: input.text, output, category, error, idCorrect,
    workaroundOk: workaroundOk(output), fallbackNeeded: category !== 'ok', latencyMs: t1 - t0 };
  log(`${phase} ${arm} r${round}: ${category}${error ? ` (${error.name})` : ''} ${Math.round(a.latencyMs)} ms`);
  return a;
}

async function environment(availability) {
  let uaData = null;
  try { uaData = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList', 'platform', 'platformVersion', 'architecture']); } catch {}
  return { date: new Date().toISOString(), userAgent: navigator.userAgent, uaData,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, availability };
}

$('avail').textContent = await LanguageModel.availability();

$('run').onclick = async () => {
  const availability = await LanguageModel.availability();
  if (availability !== 'available') return log(`availability is "${availability}"; refusing (no download).`);
  $('run').disabled = true;
  const out = {
    environment: await environment(availability),
    protocol: { system: SYSTEM, inputs: INPUTS, prompt: prompt('<input>'), schema: SCHEMA, parsingRuleVersion: PARSING_RULE_VERSION,
      workaround: 'remove one outer ``` fence (optional language tag), then the same parsing rule',
      order: 'warmup then measured; per pair of rounds ABBA (control/treatment, then treatment/control)',
      warmupPerArm: WARMUP, measuredPerArm: MEASURED, creationScope: CREATION_SCOPE, streaming: STREAMING, timeoutMs: TIMEOUT_MS },
    attempts: [],
  };
  const bases = [];
  try {
    const base = await LanguageModel.create({ initialPrompts: [SYSTEM] });
    bases.push(base);
    let index = 0;
    for (const [phase, rounds] of [['warmup', WARMUP], ['measured', MEASURED]]) {
      for (let round = 0; round < rounds; round++) {
        const arms = round % 2 === 0 ? ['control', 'treatment'] : ['treatment', 'control']; // ABBA over pairs
        for (const arm of arms) out.attempts.push(await attempt(base, { phase, arm, round, index: index++, constrained: arm === 'treatment' }));
      }
    }
    const scoped = await LanguageModel.create({ initialPrompts: [SYSTEM], responseConstraint: SCHEMA });
    bases.push(scoped);
    for (let round = 0; round < CREATION_SCOPE; round++) {
      out.attempts.push(await attempt(scoped, { phase: 'creationScope', arm: 'creationScope', round, index: index++, constrained: false }));
    }
    for (let round = 0; round < STREAMING; round++) {
      out.attempts.push(await attempt(base, { phase: 'streaming', arm: 'streaming', round, index: index++, streaming: true, constrained: true }));
    }
  } catch (e) {
    out.aborted = { name: e?.name ?? typeof e, message: e?.message ?? String(e) };
    log(`aborted: ${out.aborted.name}: ${out.aborted.message}`);
  } finally {
    for (const b of bases) try { b.destroy(); } catch {}
  }
  const pick = (phase, arm) => out.attempts.filter((a) => a.phase === phase && a.arm === arm);
  out.summary = {
    control: summarize(pick('measured', 'control')),
    treatment: summarize(pick('measured', 'treatment')),
    creationScope: summarize(pick('creationScope', 'creationScope')),
    streaming: summarize(pick('streaming', 'streaming')),
  };
  out.r1 = out.aborted ? null : decideR1(out.summary.control, out.summary.treatment);
  $('json').textContent = JSON.stringify(out, null, 2);
  log(`done: r1 = ${out.r1}`);
};
$('copy').onclick = () => navigator.clipboard.writeText($('json').textContent);
