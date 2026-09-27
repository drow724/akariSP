import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Spec 010: framework integration boundaries only (fixture contract). Counts come from the
// test-only stand-in (fixtures/standin.js) and from the fixtures' own console lines.

const root = new URL('..', import.meta.url).pathname;
const standin = join(root, 'fixtures/standin.js');
const today = () => new Date().toISOString().slice(0, 10);
const counters = (page: Page) => page.evaluate(() => ({ ...(globalThis as any).__akari }));

/** Write one environment's automated result record (one file per environment). */
export function record(id: string, data: object) {
  const dir = join(root, 'fixtures/results');
  mkdirSync(dir, { recursive: true });
  const pkg = JSON.parse(readFileSync(join(root, `fixtures/${id}/package.json`), 'utf8'));
  const file = join(dir, `automated-${id}-${today()}.json`);
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  writeFileSync(file, JSON.stringify({ ...prev, environment: id, mode: 'automated', date: today(), akarisp: pkg.dependencies.akarisp, versions: { ...pkg.dependencies, ...pkg.devDependencies }, ...data }, null, 2) + '\n');
}

/** Mount → run → stream → unmount mid-stream → 2 more mount/unmount cycles (3 + 3). */
export async function ownership(page: Page, base: string) {
  const log = { creates: 0, shutdowns: 0 };
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.text() === 'akarisp:create') log.creates++;
    if (m.text() === 'akarisp:shutdown') log.shutdowns++;
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript({ path: standin });
  await page.goto(base);
  const ready = () => expect(page.locator('#state')).toHaveText('ready');
  await ready();
  await page.click('#run');
  await expect(page.locator('#out')).toContainText('ok');
  await page.click('#stream');
  await expect(page.locator('#out')).toContainText('ab');
  await page.evaluate(() => { (globalThis as any).__akari.hold = true; });
  await page.click('#stream');
  await expect.poll(() => counters(page).then((c) => c.clones)).toBe(3); // run + 2 streams
  await page.click('#toggle'); // unmount 1, mid-stream
  for (let i = 0; i < 2; i++) {
    await page.click('#toggle'); // mount
    await ready();
    await page.click('#toggle'); // unmount
  }
  await expect.poll(() => counters(page).then((c) => c.destroys), { timeout: 5_000 }).toBe(3);
  await expect.poll(() => log.shutdowns, { timeout: 5_000 }).toBe(3);
  const { hold, createDelay, ...c } = await counters(page);
  return { ...c, logCreates: log.creates, logShutdowns: log.shutdowns, errors };
}

export function expectBalanced(r: Awaited<ReturnType<typeof ownership>>) {
  expect({ creates: r.creates, destroys: r.destroys, logCreates: r.logCreates, logShutdowns: r.logShutdowns })
    .toEqual({ creates: 3, destroys: 3, logCreates: 3, logShutdowns: 3 });
  expect(r.cloneDestroys).toBe(r.clones);
  expect(r.errors).toEqual([]);
}

for (const [id, port] of [['react-vite', 5173], ['vue-vite', 5174], ['svelte-vite', 5175]] as const) {
  test(`${id}: runtime ownership and cleanup across mount/unmount (production build)`, async ({ page }) => {
    const r = await ownership(page, `http://localhost:${port}`);
    record(id, { install: 'PASS', build: 'PASS', serve: 'PASS', browser: 'PASS', ownership: { cycles: 3, ...r } });
    expectBalanced(r);
  });
}

test('next: server/client boundary, ownership, navigation, server-evaluated probes', async ({ page, context }) => {
  const base = 'http://localhost:5176';
  const serverLog = () => readFileSync(join(root, 'fixtures/next/server.log'), 'utf8');
  const serverError = /LanguageModel|ReferenceError/;

  // (a) Server rendering, 0 runtimes on the server, 1 after hydration (M2).
  const ssr = await page.request.get(base);
  const ssrHtml = await ssr.text();
  const ssrCheck = { status: ssr.status(), hasToggle: ssrHtml.includes('id="toggle"'), serverErrorInLog: serverError.test(serverLog()) };
  await page.addInitScript({ path: standin });
  await page.goto(base);
  await expect(page.locator('#state')).toHaveText('ready');
  const afterHydration = (await counters(page)).creates;

  // (b) Ownership sequence, on a fresh page.
  const owned = await ownership(await context.newPage(), base);

  // (c) Navigation away and back (client-side routing keeps the stand-in counters).
  await page.click('#to-other');
  await page.waitForURL('**/other');
  await expect.poll(() => counters(page).then((c) => c.destroys)).toBe(1);
  await page.click('#to-home');
  await expect(page.locator('#state')).toHaveText('ready');
  const navigation = await counters(page);

  // (d) Server component importing akarisp.
  const imported = await page.request.get(`${base}/server-import`);
  const serverImport = { status: imported.status(), rendersFunction: (await imported.text()).includes('function') };

  // (e) Server component creating a runtime: observed, not asserted as desired (FR-1010, FR-1012).
  const before = serverLog().length;
  const created = await page.request.get(`${base}/server-create`);
  await expect.poll(() => serverLog().length, { timeout: 5_000 }).toBeGreaterThan(before);
  const serverCreate = { status: created.status(), log: serverLog().slice(before).replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => serverError.test(l)).slice(0, 3) };

  record('next', {
    install: 'PASS', build: 'PASS', serve: 'PASS', browser: 'PASS',
    ownership: { cycles: 3, ...owned },
    next: { ssr: ssrCheck, createsAfterHydration: afterHydration, navigation: { creates: navigation.creates, destroys: navigation.destroys }, serverImport, serverCreate },
  });

  expect(ssrCheck).toEqual({ status: 200, hasToggle: true, serverErrorInLog: false });
  expect(afterHydration).toBe(1);
  expectBalanced(owned);
  expect({ creates: navigation.creates, destroys: navigation.destroys }).toEqual({ creates: 2, destroys: 1 });
  expect(serverImport).toEqual({ status: 200, rendersFunction: true });
});

// Unmount while createRuntime() is still pending (production build). The stand-in delays
// create() so the owner's cleanup runs first; the late runtime must still be shut down.
for (const [id, port] of [['react-vite', 5173], ['vue-vite', 5174], ['svelte-vite', 5175], ['next', 5176]] as const) {
  test(`${id}: unmount while runtime creation is pending (production build)`, async ({ page }) => {
    await page.addInitScript({ path: standin });
    await page.addInitScript(() => { (globalThis as any).__akari.createDelay = 300; });
    await page.goto(`http://localhost:${port}`);
    await expect.poll(() => counters(page).then((c) => c.creates)).toBe(1);
    await page.click('#toggle'); // unmount before creation resolves
    await page.waitForTimeout(800); // creation resolves, then any late shutdown
    const { creates, destroys } = await counters(page);
    record(id, { pendingUnmount: { creates, destroys, leaked: creates - destroys } });
    expect(destroys).toBe(creates);
  });
}
