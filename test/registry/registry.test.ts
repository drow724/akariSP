import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as c from '../consumer.ts';

// Registry consumer validation (spec 009): what npm actually serves, installed into clean
// consumers outside the repository, compared with the written release intent. On demand:
// `RELEASE=<version> npm run test:registry` (network). Never packs, links, or publishes.

const repo = new URL('../..', import.meta.url).pathname;
const RELEASE: string = process.env.RELEASE ?? JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const intent = JSON.parse(readFileSync(join(repo, `releases/${RELEASE}.json`), 'utf8'));
const REGISTRY = 'https://registry.npmjs.org/';
// ponytail: fixed 20 s / 10 min re-read window for registry propagation (research R4, a practical
// bound, not an npm guarantee); REGISTRY_WINDOW_MS exists only for the mutation check.
const INTERVAL_MS = 20_000;
const WINDOW_MS = Number(process.env.REGISTRY_WINDOW_MS ?? 600_000);

let dir = '';
const env = () => ({ ...process.env, npm_config_userconfig: join(dir, 'empty.npmrc') });
const npm = (args: string[], cwd = dir) =>
  execFileSync('npm', [...args, `--registry=${REGISTRY}`, '--prefer-online'], { cwd, env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const view = (args: string[]) => { try { return JSON.parse(npm(['view', ...args, '--json']) || '{}'); } catch { return {}; } };

const result: Record<string, any> = { release: RELEASE, registry: REGISTRY, window: { intervalMs: INTERVAL_MS, maxMs: WINDOW_MS }, attempts: [], installs: {}, checks: {}, verdict: 'mismatch' };
const consumers: Record<string, string> = {}; // install spec → consumer directory

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'akarisp-registry-'));
  writeFileSync(join(dir, 'empty.npmrc'), ''); // no user npm config can redirect the registry
  result.checkedAt = new Date().toISOString();
  result.npm = npm(['--version']).trim();
});

after(() => {
  const { runtimeDependencies, publicImports, internalPathsFail, types = {} } = result.checks;
  const passed = [runtimeDependencies, publicImports, internalPathsFail, types.bundler, types.node16, types.nodenext].every((v) => v === true);
  result.verdict = passed && !result.attempts.at(-1)?.differences.length ? 'match' : 'mismatch';
  writeFileSync(join(repo, `releases/${RELEASE}.verified.json`), JSON.stringify(result, null, 2) + '\n');
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function differences() {
  const v = view([`akarisp@${RELEASE}`]);
  const tags = view(['akarisp', 'dist-tags']);
  const tagEntries = Object.entries(intent.distTags as Record<string, string>);
  const expected: Record<string, unknown> = { name: 'akarisp', version: intent.version, dependencies: intent.dependencies, exports: intent.exports,
    ...Object.fromEntries(tagEntries.map(([t, ver]) => [`distTags.${t}`, ver])) };
  const observed: Record<string, unknown> = { name: v.name, version: v.version, dependencies: v.dependencies ?? {}, exports: Object.keys(v.exports ?? {}).sort(),
    ...Object.fromEntries(tagEntries.map(([t]) => [`distTags.${t}`, tags[t]])) };
  return Object.keys(expected).filter((k) => !isDeepStrictEqual(expected[k], observed[k]))
    .map((field) => ({ field, expected: expected[field], observed: observed[field] }));
}

test('intent file names its own version', () => {
  assert.equal(intent.version, RELEASE, `releases/${RELEASE}.json declares version ${intent.version}`);
});

test('registry metadata matches the release intent (bounded re-check)', async () => {
  const start = Date.now();
  for (;;) {
    const diffs = differences();
    result.attempts.push({ at: new Date().toISOString(), differences: diffs });
    if (!diffs.length || Date.now() - start + INTERVAL_MS > WINDOW_MS) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  assert.deepEqual(result.attempts.at(-1).differences, []);
});

test('clean consumers install from the registry and resolve per intent', (t) => {
  if (result.attempts.at(-1)?.differences.length) return t.skip('metadata does not match the intent yet');
  for (const spec of ['akarisp', 'akarisp@alpha']) {
    const consumer = join(dir, spec.replace('@', '-'));
    mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
    npm(['install', '--no-package-lock', '--no-audit', '--no-fund', spec], consumer);
    cpSync(join(repo, 'test/consumer'), consumer, { recursive: true });
    consumers[spec] = consumer;
    result.installs[spec] = JSON.parse(readFileSync(join(consumer, 'node_modules/akarisp/package.json'), 'utf8')).version;
  }
  assert.equal(result.installs['akarisp@alpha'], intent.distTags.alpha);
  // A bare install is compared only when the intent names a latest target.
  if (intent.distTags.latest) assert.equal(result.installs.akarisp, intent.distTags.latest);
  const extra = Object.values(consumers).flatMap((d) => readdirSync(join(d, 'node_modules')).filter((n) => n !== 'akarisp' && !n.startsWith('.')));
  result.checks.runtimeDependencies = extra.length ? `unexpected packages: ${extra}` : true;
  assert.deepEqual(extra, []);
});

test('public imports succeed and internal paths fail in each consumer', (t) => {
  if (!Object.keys(consumers).length) return t.skip('no consumer installed');
  const problems: string[] = [];
  for (const [spec, consumer] of Object.entries(consumers)) {
    if (c.keys(consumer, 'akarisp').out !== 'TaskError,createRuntime') problems.push(`${spec}: akarisp exports`);
    if (c.keys(consumer, 'akarisp/webllm').out !== 'createWebLLMRuntime') problems.push(`${spec}: akarisp/webllm exports`);
    for (const p of c.internal) {
      if (!c.run(consumer, `await import('${p}')`).err.includes('ERR_PACKAGE_PATH_NOT_EXPORTED')) problems.push(`${spec}: ${p} importable`);
    }
  }
  result.checks.publicImports = problems.some((p) => p.endsWith('exports')) ? problems.join('; ') : true;
  result.checks.internalPathsFail = problems.some((p) => p.endsWith('importable')) ? problems.join('; ') : true;
  assert.deepEqual(problems, []);
});

test("AkariSP's declarations resolve under bundler, node16, nodenext in each consumer", (t) => {
  if (!Object.keys(consumers).length) return t.skip('no consumer installed');
  result.checks.types = {};
  for (const [resolution, module] of c.RESOLUTIONS) {
    const failures = Object.entries(consumers)
      .map(([spec, consumer]) => [spec, c.tsc(consumer, resolution, module, ['root.ts', 'webllm.ts', 'internal.ts'])] as const)
      .filter(([, r]) => r.status !== 0).map(([spec, r]) => `${spec}: ${r.stdout}`);
    result.checks.types[resolution] = failures.length ? failures.join('\n') : true;
  }
  assert.deepEqual(result.checks.types, { bundler: true, node16: true, nodenext: true });
});
