// Research-only (feature 011): observe the current runtime-creation failure semantics of the
// published package. Not a test suite, not product code. Usage (network, from the repo root):
//   node experiments/prompt-api-creation/run.mjs > experiments/prompt-api-creation/results.json
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const VERSION = process.env.AKARISP ?? '0.1.0-alpha.2';
const dir = mkdtempSync(join(tmpdir(), 'akarisp-011-'));
writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', `akarisp@${VERSION}`], { cwd: dir, stdio: 'ignore' });

// The probe body runs identically in Node (child process in the consumer) and in the browser page.
// `install` puts a stand-in LanguageModel in place (or none); counters record what AkariSP touches.
const probe = String.raw`
async function probe(mode, load) {
  const g = globalThis, out = { mode, reads: 0, calls: [] };
  const standins = {
    absent: undefined,
    unavailable: {
      async availability() { out.calls.push('availability'); return 'unavailable'; },
      // Prompt API: create() rejects NotSupportedError when the model is unavailable (stand-in).
      async create() { out.calls.push('create'); throw new DOMException('The model is not available.', 'NotSupportedError'); },
    },
    available: {
      async availability() { out.calls.push('availability'); return 'available'; },
      async create() {
        out.calls.push('create');
        const task = { async prompt() { return 'ok'; }, async *promptStreaming() { yield 'ok'; }, destroy() { out.calls.push('task.destroy'); } };
        return { async clone() { out.calls.push('clone'); return task; }, destroy() { out.calls.push('base.destroy'); } };
      },
    },
  };
  const fake = standins[mode];
  if (fake) Object.defineProperty(g, 'LanguageModel', { configurable: true, get() { out.reads++; return fake; } });
  else delete g.LanguageModel;
  out.globalPresent = 'LanguageModel' in g;
  // Experiment 1: import boundary
  const m = await load('akarisp'); const w = await load('akarisp/webllm');
  out.import = { ok: true, rootExports: Object.keys(m).sort(), webllmExports: Object.keys(w).sort(), readsAfterImport: out.reads };
  // Experiments 2-4: public creation path
  let ret, sync = null;
  try { ret = m.createRuntime(); } catch (e) { sync = { name: e.name, message: e.message }; }
  out.create = { threwSynchronously: sync, returnedPromise: ret instanceof Promise };
  if (ret) {
    try {
      const rt = await ret;
      const r = await rt.run('hi');
      await rt.shutdown();
      out.create.result = { ok: true, output: r.output, stateAfterShutdown: rt.state };
    } catch (e) {
      out.create.result = { ok: false, constructor: e?.constructor?.name, name: e?.name, message: e?.message,
        isTaskError: e?.name === 'TaskError', code: e?.code, isDOMException: typeof DOMException !== 'undefined' && e instanceof DOMException,
        stackTop: String(e?.stack ?? '').split('\n').slice(0, 4).map((l) => l.trim()) };
    }
  }
  out.calls = [...out.calls];
  if (fake) delete g.LanguageModel;
  return out;
}`;

const results = { akarisp: VERSION, date: new Date().toISOString(), node: process.version, env: {} };

// Node / SSR-like
for (const mode of ['absent', 'unavailable', 'available']) {
  const code = `${probe}\nconsole.log(JSON.stringify(await probe('${mode}', (s) => import(s))));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8' });
  results.env[`node:${mode}`] = JSON.parse(out);
}

// Browser (Chromium; no built-in Prompt API) — package files served from the consumer via routing.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://akari.test/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<script type="importmap">{"imports":{"akarisp":"/node_modules/akarisp/dist/index.js","akarisp/webllm":"/node_modules/akarisp/dist/webllm.js"}}</script>` });
  route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(dir, path)) });
});
await page.goto('http://akari.test/');
results.env.chromium = { version: browser.version(), nativeLanguageModel: await page.evaluate(() => 'LanguageModel' in globalThis) };
for (const mode of ['absent', 'unavailable', 'available']) {
  results.env[`browser:${mode}`] = await page.evaluate(async ([src, mode]) => {
    const probe = (0, eval)(`(${src.trim().replace(/^async function probe/, 'async function')})`);
    return probe(mode, (s) => import(s));
  }, [probe, mode]);
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
