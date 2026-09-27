import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Core / browser boundary (spec 005). Not a claim that Node is a supported provider.

test('importing the core reads no LanguageModel global', async () => {
  let reads = 0;
  Object.defineProperty(globalThis, 'LanguageModel', {
    configurable: true,
    get() { reads++; throw new Error('LanguageModel read'); },
  });
  try {
    await import('../src/core/runtime.ts');
    assert.equal(reads, 0);
  } finally {
    delete (globalThis as any).LanguageModel;
  }
});

test('core source has no browser globals and no browser import', () => {
  const dir = new URL('../src/core/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const code = readFileSync(new URL(file, dir), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\b(LanguageModel|window|globalThis|navigator|self|document)\b/, file);
    assert.doesNotMatch(code, /(from|import\()\s*['"][^'"]*browser/, file);
  }
});

test('public value exports are unchanged from 004', async () => {
  assert.deepEqual(Object.keys(await import('../src/index.ts')).sort(), ['TaskError', 'createRuntime']);
});

// 007 architecture invariants (comments stripped, so documentation never matches).
const code = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const specifiers = (src: string) => [...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

test('core has no clone dependency: no .clone( call and no clone member on Session', () => {
  const core = code('../src/core/runtime.ts');
  assert.doesNotMatch(core, /\.clone\s*\(/);
  const session = core.match(/export interface Session \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(session, 'Session interface found');
  assert.doesNotMatch(session, /\bclone\b/);
});

test('core broken decision uses no provider error vocabulary', () => {
  const core = code('../src/core/runtime.ts');
  assert.doesNotMatch(core, /InvalidStateError/);
  // DOMException only as the standard shutdown abort reason.
  assert.deepEqual(core.match(/DOMException\([^)]*\)/g), ["DOMException('Runtime closed', 'AbortError')"]);
});

test('core imports nothing from browser or webllm', () => {
  for (const s of specifiers(code('../src/core/runtime.ts'))) assert.doesNotMatch(s, /browser|webllm/, s);
});

test('the WebLLM module imports only the core', () => {
  assert.deepEqual(specifiers(code('../src/webllm/runtime.ts')), ['../core/runtime.ts']);
});

test('runtime dependencies stay empty', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
});
