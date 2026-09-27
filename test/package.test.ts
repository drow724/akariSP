import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

// The packed tarball is the product (spec 008). Everything below runs against a consumer
// installed from it, outside the repository. Never import 'akarisp' in this process: Node's
// package self-reference would resolve it to this repository's dist, not the tarball.

const repo = new URL('..', import.meta.url).pathname;
const snapshotFile = join(repo, 'api/akarisp.api.txt');
let dir = '';
let consumer = '';
let pack: { filename: string; files: { path: string }[] };

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'akarisp-pack-'));
  consumer = join(dir, 'consumer');
  const out = execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: repo, encoding: 'utf8' });
  [pack] = JSON.parse(out.slice(out.search(/^\[/m)));
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  execFileSync('npm', ['install', '--offline', '--no-audit', '--no-fund', '--no-package-lock', join(dir, pack.filename)], { cwd: consumer });
  cpSync(join(repo, 'test/consumer'), consumer, { recursive: true });
});

after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

/** Run code in a child process inside the consumer, so resolution goes through the tarball. */
function run(code: string, commonjs = false) {
  const args = commonjs ? ['-e', code] : ['--input-type=module', '-e', code];
  const r = spawnSync(process.execPath, args, { cwd: consumer, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr };
}
const keys = (spec: string) => run(`const m = await import('${spec}'); console.log(Object.keys(m).sort().join())`);

test('tarball contains exactly the allow-listed files', () => {
  const allowed = ['LICENSE', 'README.md', 'package.json',
    ...['index', 'webllm', 'core/runtime', 'browser/runtime', 'webllm/runtime'].flatMap((f) => [`dist/${f}.js`, `dist/${f}.d.ts`])];
  const files = pack.files.map((f) => f.path);
  assert.deepEqual({ unexpected: files.filter((f) => !allowed.includes(f)), missing: allowed.filter((f) => !files.includes(f)) },
    { unexpected: [], missing: [] });
});

test('installed metadata: version, no dependencies, no engines', () => {
  const pkg = JSON.parse(readFileSync(join(consumer, 'node_modules/akarisp/package.json'), 'utf8'));
  assert.equal(pkg.version, '0.1.0-alpha.0');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.engines, undefined);
});

test('public entry points export exactly their names', () => {
  assert.deepEqual(keys('akarisp'), { ok: true, out: 'TaskError,createRuntime', err: '' });
  assert.deepEqual(keys('akarisp/webllm'), { ok: true, out: 'createWebLLMRuntime', err: '' });
});

const internal = ['akarisp/core', 'akarisp/browser', 'akarisp/internal', 'akarisp/dist/index.js',
  'akarisp/dist/core/runtime.js', 'akarisp/src/index.ts', 'akarisp/package.json'];

/** Type-check consumer files with the repository's TypeScript. */
function tsc(resolution: string, module: string, files: string[]) {
  return spawnSync(join(repo, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--target', 'es2022', '--lib', 'es2022,dom',
    '--skipLibCheck', 'false', '--moduleResolution', resolution, '--module', module, ...files], { cwd: consumer, encoding: 'utf8' });
}

for (const [resolution, module] of [['bundler', 'esnext'], ['node16', 'node16'], ['nodenext', 'nodenext']]) {
  test(`consumer type-checks under moduleResolution ${resolution} (public ok, internal paths fail)`, () => {
    const r = tsc(resolution, module, ['root.ts', 'webllm.ts', 'internal.ts']);
    assert.equal(r.status, 0, r.stdout); // an unused @ts-expect-error in internal.ts fails too
  });
}

test('README code samples compile against the packed package', () => {
  // The README shipped in the tarball, so the check fails whenever the documented usage and the
  // published API disagree.
  const readme = readFileSync(join(consumer, 'node_modules/akarisp/README.md'), 'utf8');
  const files = [...readme.matchAll(/```js\n([\s\S]*?)```/g)].map(([, code], i) => {
    writeFileSync(join(consumer, `readme-${i}.ts`), `${code}export {};\n`);
    return `readme-${i}.ts`;
  });
  assert.equal(files.length, 5);
  const r = tsc('bundler', 'esnext', ['readme-globals.d.ts', ...files]);
  assert.equal(r.status, 0, r.stdout);
});

test('internal paths are not importable at runtime', () => {
  for (const spec of internal) {
    const r = run(`await import('${spec}')`);
    assert.ok(!r.ok && r.err.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'), `${spec}: ${r.err}`);
  }
});

// Observed on Node 23.9: require() of this ESM-only package works (require(esm)). Recorded, not
// assumed, so a change in the artifact or runtime is detected (spec 008 edge case).
test('CommonJS require() of the ESM-only package: observed behavior', () => {
  assert.deepEqual(run("console.log(Object.keys(require('akarisp')).sort().join())", true),
    { ok: true, out: 'TaskError,createRuntime', err: '' });
});

/** Public surface of the installed package: the declaration text of every export of each
 *  entry point, plus the declarations of the non-exported local types they reference
 *  (recursively), since those shapes are what consumers are type-checked against. */
function surface() {
  const probe = join(consumer, '__surface.ts');
  const entries = ['akarisp', 'akarisp/webllm'];
  writeFileSync(probe, entries.map((e, i) => `import * as m${i} from '${e}';\n`).join(''));
  const program = ts.createProgram([probe], { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, noEmit: true, types: [] });
  const checker = program.getTypeChecker();
  const real = (s: ts.Symbol) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
  const inPackage = (d: ts.Node) => d.getSourceFile().fileName.includes('/node_modules/akarisp/');
  const text = (d: ts.Node) => d.getText().replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/^(export )?(declare )?/, '')
    .split('\n').map((l) => l.trimEnd()).filter(Boolean).join('\n');
  const modules = program.getSourceFile(probe)!.statements.filter(ts.isImportDeclaration)
    .map((d) => checker.getSymbolAtLocation(d.moduleSpecifier));
  const exported = modules.map((m) => (m ? checker.getExportsOfModule(m).map(real) : undefined));
  const pub = new Set(exported.flat());
  const locals = new Map<ts.Symbol, string>();
  const collect = (node: ts.Node) => {
    const ref = ts.isTypeReferenceNode(node) ? node.typeName : ts.isExpressionWithTypeArguments(node) ? node.expression : undefined;
    const s = ref && checker.getSymbolAtLocation(ref);
    const d = s && real(s).declarations?.[0];
    if (s && d && inPackage(d) && !pub.has(real(s)) && !locals.has(real(s))) {
      locals.set(real(s), text(d));
      collect(d);
    }
    ts.forEachChild(node, collect);
  };
  const out = entries.flatMap((e, i) => [`# ${e}`, ...(exported[i]
    ?.sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => s.declarations!.map((d) => (collect(d), text(d))).join('\n')) ?? ['(missing)'])]);
  out.push('# local types (not importable)', ...[...locals.values()].sort());
  rmSync(probe);
  return out.join('\n') + '\n';
}

test('public API surface matches api/akarisp.api.txt (UPDATE_API=1 to rewrite)', () => {
  const actual = surface();
  if (process.env.UPDATE_API) writeFileSync(snapshotFile, actual);
  assert.equal(actual, readFileSync(snapshotFile, 'utf8'));
});
