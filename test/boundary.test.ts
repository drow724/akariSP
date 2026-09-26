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
