import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Browser integration only: the LanguageModel global, the create adapter, and the public entry.
// Scheduling and session lifecycle are covered by the core suite (runtime.test.ts).

let reads = 0;
/** Installs globalThis.LanguageModel as a getter that counts reads; throws if no fake is given. */
function installGlobal(fake?: object) {
  reads = 0;
  Object.defineProperty(globalThis, 'LanguageModel', {
    configurable: true,
    get() {
      reads++;
      if (!fake) throw new Error('LanguageModel read');
      return fake;
    },
  });
}
afterEach(() => { delete (globalThis as any).LanguageModel; });

const entry = () => import('../src/index.ts');

test('importing the entry reads no global', async () => {
  installGlobal();
  await entry();
  assert.equal(reads, 0);
});

test('option validation fails before the global is read', async () => {
  installGlobal();
  const { createRuntime } = await entry();
  for (const options of [{ limit: 0 }, { queueCapacity: -1 }, { templates: {} }]) {
    await assert.rejects(createRuntime(options), TypeError);
  }
  assert.equal(reads, 0);
});

test('no global: creating a runtime rejects with ReferenceError', async () => {
  const { createRuntime } = await entry();
  await assert.rejects(createRuntime(), ReferenceError);
});

test('create receives the session and template config objects unchanged', async () => {
  const configs: unknown[] = [];
  installGlobal({ async create(config: unknown) { configs.push(config); return { destroy() {} }; } });
  const { createRuntime } = await entry();
  const session = { initialPrompts: [] }, a = { initialPrompts: [] };
  const runtime = await createRuntime({ session, templates: { a } });
  assert.equal(configs.length, 2);
  assert.equal(configs[0], session);
  assert.equal(configs[1], a);
  await runtime.shutdown();
});

test('the native session is used by the core as returned', async () => {
  let cloned: unknown;
  const native = {
    async clone(this: unknown) {
      cloned = this;
      return { prompt: async (input: string) => `native:${input}`, destroy() {} };
    },
    destroy() {},
  };
  installGlobal({ create: async () => native });
  const { createRuntime } = await entry();
  const runtime = await createRuntime();
  assert.equal((await runtime.run('x')).output, 'native:x');
  assert.equal(cloned, native);
  await runtime.shutdown();
});

test('Chrome broken rule: a DOMException named InvalidStateError from clone breaks the runtime', async () => {
  const native = { async clone() { throw new DOMException('gone', 'InvalidStateError'); }, destroy() {} };
  installGlobal({ create: async () => native });
  const { createRuntime } = await entry();
  const runtime = await createRuntime();
  await assert.rejects(runtime.run('x'), (e: any) => e.code === 'broken');
  assert.equal(runtime.state, 'broken');
});

test('Chrome broken rule: a lookalike error named InvalidStateError only fails the task', async () => {
  const native = { async clone() { throw { name: 'InvalidStateError' }; }, destroy() {} };
  installGlobal({ create: async () => native });
  const { createRuntime } = await entry();
  const runtime = await createRuntime();
  await assert.rejects(runtime.run('x'), (e: any) => e.code === 'failed');
  assert.equal(runtime.state, 'ready');
  await runtime.shutdown();
});
