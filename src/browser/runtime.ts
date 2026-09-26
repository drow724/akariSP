import { createCoreRuntime, type Runtime, type RuntimeOptions, type SessionProvider } from '../core/runtime.ts';

declare const LanguageModel: SessionProvider;
const promptApi: SessionProvider = { create: (config) => LanguageModel.create(config) };

/** Create a runtime backed by the browser's built-in Prompt API. The native global is read
 *  only when a base session is created. */
export function createRuntime(options?: RuntimeOptions): Promise<Runtime> {
  return createCoreRuntime(promptApi, options);
}
