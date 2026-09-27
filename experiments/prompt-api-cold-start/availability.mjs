// Research-only (pre-feature 012): REAL_BROWSER availability probe in branded Chrome with a fresh,
// disposable user-data-dir. Calls LanguageModel.availability() only — never create(), so no model
// download is started. Usage: node experiments/prompt-api-cold-start/availability.mjs
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = mkdtempSync(join(tmpdir(), 'akarisp-012-profile-'));
// Playwright disables component updates by default; keep Chrome's normal model-management behavior.
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, ignoreDefaultArgs: ['--disable-component-update'] });
const page = context.pages()[0] ?? await context.newPage();
await page.route('http://localhost:8123/**', (r) => r.fulfill({ contentType: 'text/html', body: '<button id="b">activate</button>' }));
await page.goto('http://localhost:8123/');
const probe = () => page.evaluate(async () => ({
  secureContext: isSecureContext,
  present: 'LanguageModel' in globalThis,
  availability: 'LanguageModel' in globalThis ? await LanguageModel.availability().catch((e) => `error:${e.name}`) : null,
  userActivation: { isActive: navigator.userActivation?.isActive, hasBeenActive: navigator.userActivation?.hasBeenActive },
}));
const before = await probe();
await page.click('#b'); // trusted user activation; still no create()
const afterActivation = await probe();
const result = { evidence: 'REAL_BROWSER', date: new Date().toISOString(), browser: `Chrome ${context.browser()?.version() ?? ''}`.trim(), profile: 'fresh temporary user-data-dir (deleted afterwards)', userAgent: await page.evaluate(() => navigator.userAgent), before, afterActivation, createCalled: false };
await context.close();
rmSync(profile, { recursive: true, force: true });
console.log(JSON.stringify(result, null, 2));
