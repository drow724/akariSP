import { test, expect, type Page } from '@playwright/test';

// Layer 2 (spec 006): the compatibility page on Chromium / Firefox / WebKit engines. One file for
// all projects; no expectation depends on the engine name. Never clicks a lifecycle button on a
// real API, so no model download or inference can start. Engine results are not browser-product
// evidence (WebKit ≠ Safari).

const LIFECYCLE = ['run', 'streaming', 'earlyBreak', 'callerAbort', 'shutdownDuringStreaming', 'lazyStream', 'cloneIsolation'];

async function load(page: Page, engine: string, init?: () => void) {
  if (init) await page.addInitScript(init);
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(`/smoke/streaming.html?runner=playwright&engine=${engine}`);
  await page.waitForSelector('body[data-ready="true"]');
  const doc = JSON.parse(await page.locator('#json').textContent() ?? '');
  return { doc, errors };
}

test('native capability: import-safe, classified from what the page observes', async ({ page, browserName }) => {
  const { doc, errors } = await load(page, browserName);
  expect(errors).toEqual([]);
  expect(Object.keys(doc).sort()).toEqual(['capability', 'overall', 'recordedAt', 'runner', 'secureContext', 'tests', 'userAgent']);
  expect(Object.keys(doc.capability).sort()).toEqual(['availability', 'classification', 'error', 'languageModelPresent']);
  expect(doc.runner).toEqual({ kind: 'playwright', engine: browserName });
  expect(doc.tests.import.status).toBe('PASS');
  expect(doc.secureContext).toBe(true);
  await expect(page.locator('#secure')).toHaveText('true');
  await expect(page.locator('#ua')).not.toBeEmpty();

  const present = await page.evaluate(() => 'LanguageModel' in globalThis);
  expect(doc.capability.languageModelPresent).toBe(present);
  if (!present) {
    expect(doc.capability.classification).toBe('API_ABSENT');
    for (const k of LIFECYCLE) {
      expect(doc.tests[k].status, k).toBe('SKIPPED');
      expect(doc.tests[k].reason, k).toBeTruthy();
    }
    expect(doc.overall).toBe('SKIPPED');
  } else {
    // Capability evidence only: consistency with the gate, nothing executed.
    for (const k of LIFECYCLE) {
      if (doc.capability.classification === 'MODEL_AVAILABLE') expect(doc.tests[k], k).toBeUndefined();
      else expect(doc.tests[k].status, k).toBe('BLOCKED');
    }
  }
});

// Stand-ins for non-available states only; none ever reports 'available' (FR-512).
const CASES: { name: string; availability: string | null; classification: string; raw: string | null; errorName?: string }[] = [
  { name: 'unavailable', availability: 'unavailable', classification: 'API_PRESENT_UNAVAILABLE', raw: 'unavailable' },
  { name: 'downloadable', availability: 'downloadable', classification: 'MODEL_DOWNLOADABLE', raw: 'downloadable' },
  { name: 'downloading', availability: 'downloading', classification: 'MODEL_DOWNLOADING', raw: 'downloading' },
  { name: 'unknown', availability: 'future-state-x', classification: 'UNKNOWN_AVAILABILITY', raw: 'future-state-x' },
  { name: 'throws', availability: 'THROW', classification: 'API_PRESENT_UNAVAILABLE', raw: null, errorName: 'NotSupportedError' },
  { name: 'missing', availability: null, classification: 'API_PRESENT_UNAVAILABLE', raw: null },
];

for (const c of CASES) {
  test(`stand-in ${c.name}: classified, all lifecycle BLOCKED, create() never called`, async ({ page, browserName }) => {
    await page.addInitScript((mode) => {
      const g = globalThis as any;
      g.__creates = 0;
      g.LanguageModel = { create() { g.__creates++; throw new Error('stand-in'); } };
      if (mode === 'THROW') g.LanguageModel.availability = async () => { throw new DOMException('x', 'NotSupportedError'); };
      else if (mode !== null) g.LanguageModel.availability = async () => mode;
    }, c.availability);
    const { doc, errors } = await load(page, browserName);
    expect(errors).toEqual([]);
    expect(doc.tests.import.status).toBe('PASS');
    expect(doc.capability.languageModelPresent).toBe(true);
    expect(doc.capability.classification).toBe(c.classification);
    expect(doc.capability.availability).toBe(c.raw);
    if (c.errorName) expect(doc.capability.error.name).toBe(c.errorName);
    for (const k of LIFECYCLE) {
      expect(doc.tests[k].status, k).toBe('BLOCKED');
      expect(doc.tests[k].reason, k).toBeTruthy();
    }
    expect(doc.overall).toBe('BLOCKED');

    if (c.name === 'downloadable') {
      for (const label of ['Normal run', 'Normal streaming', 'Early break', 'Caller abort', 'Shutdown during streaming', 'Lazy stream', 'Clone isolation', 'Run All']) {
        await page.getByRole('button', { name: label, exact: true }).click();
        await expect(page.getByRole('button', { name: 'Run All', exact: true })).toBeEnabled();
      }
      const after = JSON.parse(await page.locator('#json').textContent() ?? '');
      for (const k of LIFECYCLE) expect(after.tests[k].status, k).toBe('BLOCKED');
      expect(after.overall).toBe('BLOCKED');
    }
    expect(await page.evaluate(() => (globalThis as any).__creates)).toBe(0);
  });
}
