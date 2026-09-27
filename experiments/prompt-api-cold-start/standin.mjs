// Research-only (pre-feature 012): native create-option passthrough and creation abort, with a
// stand-in LanguageModel that follows the Prompt API explainer's signal semantics. STAND_IN evidence
// only: it proves what AkariSP forwards, not what a real browser does.
// Usage (network, repo root): node experiments/prompt-api-cold-start/standin.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = process.env.AKARISP ?? '0.1.0-alpha.2';
const dir = mkdtempSync(join(tmpdir(), 'akarisp-012-'));
writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', `akarisp@${VERSION}`], { cwd: dir, stdio: 'ignore' });

const code = String.raw`
const r = {};
let received, createCalls = 0, holdCreate = false, release;
const destroyedBases = [];
// Stand-in: explainer semantics — abort during create rejects create() with signal.reason;
// abort after create destroys that session (later clone rejects InvalidStateError).
globalThis.LanguageModel = {
  async create(options) {
    createCalls++; received = options;
    const signal = options?.signal;
    if (signal?.aborted) throw signal.reason;
    if (holdCreate) await new Promise((res, rej) => { release = res; signal?.addEventListener('abort', () => rej(signal.reason), { once: true }); });
    const base = { destroyed: false,
      async clone() { if (base.destroyed) throw new DOMException('The session was destroyed.', 'InvalidStateError');
        return { async prompt() { return 'ok'; }, async *promptStreaming() { yield 'ok'; }, destroy() {} }; },
      destroy() { base.destroyed = true; destroyedBases.push(base); } };
    signal?.addEventListener('abort', () => base.destroy(), { once: true });
    return base;
  },
};
const { createRuntime } = await import('akarisp');

// E1: passthrough
{
  let monitorCalls = 0; const ctrl = new AbortController();
  const listenersBefore = 0;
  const origAdd = ctrl.signal.addEventListener.bind(ctrl.signal); let akarisListeners = 0;
  const session = { temperature: 0.2, topK: 3, expectedInputs: [{ type: 'text' }], custom: 'x', signal: ctrl.signal, monitor(m) { monitorCalls++; } };
  const rt = await createRuntime({ session });
  r.passthrough = { sameObject: received === session, keys: Object.keys(received).sort(), signalPreserved: received.signal === ctrl.signal,
    monitorPreserved: received.monitor === session.monitor, monitorCalledByAkariSP: monitorCalls, createCalls };
  await rt.shutdown();
}
// E3b: abort while create is pending
{
  holdCreate = true; createCalls = 0; destroyedBases.length = 0; const ctrl = new AbortController();
  const t0 = performance.now(); const p = createRuntime({ session: { signal: ctrl.signal } });
  await new Promise((res) => setTimeout(res, 20)); ctrl.abort();
  let outcome;
  try { await p; outcome = { resolved: true }; } catch (e) { outcome = { rejected: true, constructor: e?.constructor?.name, name: e?.name, message: e?.message, isTaskError: e?.name === 'TaskError', ms: Math.round(performance.now() - t0) }; }
  r.abortDuringCreate = { ...outcome, createCalls, basesDestroyedByAkariSP: destroyedBases.length };
  holdCreate = false;
}
// E3c: abort after create (explainer: destroys the session) — what does AkariSP see?
{
  destroyedBases.length = 0; const ctrl = new AbortController();
  const rt = await createRuntime({ session: { signal: ctrl.signal } });
  const before = (await rt.run('hi')).output;
  ctrl.abort();
  let after; try { after = (await rt.run('hi')).output; } catch (e) { after = { name: e?.name, code: e?.code, cause: e?.cause?.name }; }
  r.abortAfterCreate = { runBefore: before, runAfterAbort: after, stateAfter: rt.state };
  await rt.shutdown(); r.abortAfterCreate.shutdown = 'resolved'; r.abortAfterCreate.stateAfterShutdown = rt.state;
}
console.log(JSON.stringify(r));
`;
const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8' });
console.log(JSON.stringify({ akarisp: VERSION, node: process.version, date: new Date().toISOString(), evidence: 'STAND_IN', ...JSON.parse(out) }, null, 2));
