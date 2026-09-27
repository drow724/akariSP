// Research-only (pre-feature 012): REAL_BROWSER evidence for how a destroyed or document-detached
// native base rejects clone(), and how AkariSP classifies it. Loads the repository build (run
// `npm run build` first; serve the repo root). AkariSP is unmodified; E5b only points the
// LanguageModel global at an iframe's LanguageModel for one create() call.
import { createRuntime, TaskError } from '../../dist/index.js';

const SESSION = { initialPrompts: [{ role: 'system', content: 'Answer in one word.' }] };
const $ = (id) => document.getElementById(id);
const log = (s) => { $('log').textContent += s + '\n'; };
const describe = (v) => v === undefined ? null
  : { ctor: v?.constructor?.name ?? typeof v, name: v?.name ?? null, message: v?.message ?? String(v) };
const TIMEOUT = 15000;
// Settles an operation as { ok } / { error } / { timeout } so a hung native call cannot stall the page.
const attempt = async (f) => {
  let timer;
  try {
    const v = await Promise.race([f(), new Promise((_, rej) => { timer = setTimeout(() => rej(TIMEOUT), TIMEOUT); })]);
    return { ok: true, value: typeof v === 'string' ? v.slice(0, 40) : describe(v)?.ctor ?? null };
  } catch (e) {
    if (e === TIMEOUT) return { timeout: TIMEOUT };
    return { error: describe(e), isTaskError: e instanceof TaskError, code: e?.code ?? null, cause: describe(e?.cause) };
  } finally { clearTimeout(timer); }
};
const cloneOnce = async (m) => { const c = await m.clone(); c.destroy(); return 'cloned'; };

$('avail').textContent = await LanguageModel.availability();

$('run').onclick = async () => {
  const availability = await LanguageModel.availability();
  if (availability !== 'available') return log(`availability is "${availability}"; refusing (no download).`);
  $('run').disabled = true;
  const out = { environment: { userAgent: navigator.userAgent, date: new Date().toISOString().slice(0, 10), availability } };

  // E4: direct native behaviour, outside AkariSP.
  {
    const m = await LanguageModel.create(SESSION);
    const before = await attempt(() => cloneOnce(m));
    m.destroy();
    out.nativeDestroy = { cloneBefore: before, cloneAfter1: await attempt(() => cloneOnce(m)),
      cloneAfter2: await attempt(() => cloneOnce(m)), promptAfter: await attempt(() => m.prompt('hi')) };
    log('E4 destroy() done');
  }
  for (const [label, reason] of [['default', undefined], ['custom', new Error('app shutting down')]]) {
    const c = new AbortController();
    const m = await LanguageModel.create({ ...SESSION, signal: c.signal });
    const before = await attempt(() => cloneOnce(m));
    c.abort(reason);
    out[`nativeCreateSignalAbort_${label}`] = { abortReason: describe(c.signal.reason), cloneBefore: before,
      cloneAfter1: await attempt(() => cloneOnce(m)), cloneAfter2: await attempt(() => cloneOnce(m)) };
    try { m.destroy(); } catch {}
    log(`E4 create-signal abort (${label}) done`);
  }

  // E3: the same destruction behind AkariSP (create signal passed through `session`).
  for (const [label, reason] of [['default', undefined], ['custom', new Error('app shutting down')]]) {
    const c = new AbortController();
    const rt = await createRuntime({ session: { ...SESSION, signal: c.signal } });
    const first = await attempt(() => rt.run('Say ok.').then((r) => r.output));
    c.abort(reason);
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push({ ...(await attempt(() => rt.run('Say ok.').then((r) => r.output))), stateAfter: rt.state });
    out[`akarispCreateSignalAbort_${label}`] = { abortReason: describe(c.signal.reason), firstRun: first,
      stateBeforeAbort: 'ready', runsAfterAbort: runs, shutdown: await attempt(() => rt.shutdown()), stateAfterShutdown: rt.state };
    log(`E3 AkariSP create-signal abort (${label}) done`);
  }

  // E5: a base whose Document stops being fully active (disposable same-origin iframe, removed).
  const frame = async () => {
    const f = document.createElement('iframe');
    f.src = 'about:blank';
    document.body.append(f);
    await new Promise((r) => setTimeout(r, 50));
    return f;
  };
  {
    const f = await frame();
    const LM = f.contentWindow.LanguageModel;
    if (!LM) out.nativeDetachedDocument = { blocked: 'LanguageModel not exposed in the iframe' };
    else {
      const m = await LM.create(SESSION);
      const before = await attempt(() => cloneOnce(m));
      f.remove();
      out.nativeDetachedDocument = { cloneBefore: before, cloneAfter1: await attempt(() => cloneOnce(m)),
        cloneAfter2: await attempt(() => cloneOnce(m)) };
      try { m.destroy(); } catch (e) { out.nativeDetachedDocument.destroyAfter = describe(e); }
    }
    log('E5a native detached document done');
  }
  {
    const f = await frame();
    const LM = f.contentWindow.LanguageModel;
    if (!LM) out.akarispDetachedDocument = { blocked: 'LanguageModel not exposed in the iframe' };
    else {
      const desc = Object.getOwnPropertyDescriptor(globalThis, 'LanguageModel');
      Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, writable: true, value: LM });
      let rt;
      try { rt = await createRuntime({ session: SESSION }); }
      finally { Object.defineProperty(globalThis, 'LanguageModel', desc); }
      const first = await attempt(() => rt.run('Say ok.').then((r) => r.output));
      f.remove();
      const runs = [];
      for (let i = 0; i < 2; i++) runs.push({ ...(await attempt(() => rt.run('Say ok.').then((r) => r.output))), stateAfter: rt.state });
      out.akarispDetachedDocument = { firstRun: first, runsAfterDetach: runs,
        shutdown: await attempt(() => rt.shutdown()), stateAfterShutdown: rt.state };
    }
    log('E5b AkariSP detached document done');
  }

  $('json').textContent = JSON.stringify(out, null, 2);
  log('done');
};
$('copy').onclick = () => navigator.clipboard.writeText($('json').textContent);
