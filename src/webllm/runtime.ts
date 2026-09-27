import { createCoreRuntime, type Runtime, type RuntimeOptions, type Session, type SessionProvider } from '../core/runtime.ts';

// Internal WebLLM integration (007): validates the core seam with a second real provider.
// Not exported from the package root; whether it becomes public, a separate package, or a
// different extension boundary is decided in 008. Behavior targets @mlc-ai/web-llm 0.2.85.

type Chunk = { choices: { delta?: { content?: string | null } }[] };

/** The subset of a WebLLM MLCEngine this module uses. */
export interface WebLLMEngine {
  chat: { completions: { create(request: object): Promise<AsyncIterable<Chunk>> } };
  interruptGenerate(): Promise<void>;
  getMessage(): Promise<string>;
  unload(): Promise<void>;
}

type Config = { initialPrompts?: readonly object[] } & Record<string, unknown>;

/** Create a runtime on an application-created WebLLM engine.
 *
 *  Ownership: once this resolves, the runtime uses the engine exclusively (do not run other
 *  generations on it) and unloads it at shutdown. If creation fails, the engine is untouched.
 *  `limit` must be 1: one engine generates one request at a time, and waiting tasks must stay in
 *  AkariSP's queue where cancellation is task-local (007 research E3, E4). */
export async function createWebLLMRuntime(engine: WebLLMEngine, options: RuntimeOptions = {}): Promise<Runtime> {
  if (options.limit !== undefined && options.limit > 1) {
    throw new TypeError('limit must be 1 for a WebLLM engine (one generation at a time)');
  }
  // A template is request configuration, so no destroy(base); the engine is the one
  // provider-wide resource, so close() unloads it.
  const provider: SessionProvider<Config> = {
    create: async (config = {}) => config as Config,
    start: async (base) => {
      await engine.getMessage(); // throws ModelNotLoadedError once the engine is unloaded
      return task(engine, base);
    },
    broken: (e) => ['ModelNotLoadedError', 'DeviceLostError'].includes((e as Error)?.name),
    close: () => engine.unload(),
  };
  return createCoreRuntime(provider, options);
}

function task(engine: WebLLMEngine, base: Config): Session {
  const { initialPrompts = [], ...settings } = base;
  let it: AsyncIterator<Chunk> | undefined;
  let pulled = false;
  let done = false;

  // Always streaming, also for prompt(): a non-streaming request after an interrupt returns ""
  // in 0.2.85 (E5), while a streaming request resets the interrupt flag.
  async function* promptStreaming(input: unknown, { signal }: { signal: AbortSignal }) {
    const onAbort = () => void engine.interruptGenerate();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const messages = [...initialPrompts, ...(typeof input === 'string' ? [{ role: 'user', content: input }] : input as object[])];
      it = (await engine.chat.completions.create({ ...settings, messages, stream: true }))[Symbol.asyncIterator]();
      // ponytail: manual next(), never for-await over `it`: leaving a for-await calls it.return(),
      // which leaks the engine lock in 0.2.85 (E6). Switch once a release frees it in finally.
      while (!signal.aborted) {
        pulled = true;
        const r = await it.next();
        if (r.done) { done = true; break; }
        const text = r.value.choices[0]?.delta?.content;
        if (text) yield text;
      }
      if (signal.aborted) throw signal.reason; // an interrupted generation ends without an error (E8)
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    promptStreaming,
    async prompt(input, options) {
      let output = '';
      for await (const chunk of promptStreaming(input, options)) output += chunk;
      return output;
    },
    // Interrupt and drain to the natural end: the only way 0.2.85 releases its lock (E6b).
    // Called once per task by the core's end().
    async destroy() {
      if (!it || done) return;
      // ponytail: 0.2.85 resets the interrupt flag on the first next(), so an interrupt before it
      // is lost; pulling first costs up to one time-to-first-token of cleanup latency.
      if (!pulled && (await it.next()).done) return;
      await engine.interruptGenerate();
      while (!(await it.next()).done);
    },
  };
}
