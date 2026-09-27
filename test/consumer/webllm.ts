// Type-checked against the packed tarball by test/package.test.ts; never executed.
// A local structural engine: no WebLLM dependency is needed to use akarisp/webllm.
import type { Runtime } from 'akarisp';
import { createWebLLMRuntime } from 'akarisp/webllm';

const engine = {
  chat: { completions: { create: async (_request: object) => (async function* () { yield { choices: [{ delta: { content: 'a' } }] }; })() } },
  interruptGenerate: async () => {},
  getMessage: async () => '',
  unload: async () => {},
};
const runtime: Runtime = await createWebLLMRuntime(engine, { session: { initialPrompts: [] }, queueCapacity: 8 });
await runtime.shutdown();
