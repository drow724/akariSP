import { createCoreRuntime, type Runtime, type RuntimeOptions, type Session, type SessionProvider } from '../core/runtime.ts';

// Chrome's native session: the base per template, and (via clone) the task session itself.
interface NativeSession extends Session {
  clone(options?: { signal?: AbortSignal }): Promise<NativeSession>;
}
declare const LanguageModel: { create(options?: object): Promise<NativeSession> };

// Owns one warm session per template (destroy) and nothing provider-wide, so no close().
const promptApi: SessionProvider<NativeSession> = {
  create: (config) => LanguageModel.create(config),
  start: (base, options) => base.clone(options),
  // ponytail: InvalidStateError = base no longer trusted (005 research R2); revisit if the
  // Prompt API spec defines destroyed-session errors differently.
  broken: (e) => e instanceof DOMException && e.name === 'InvalidStateError',
  destroy: (base) => base.destroy(),
};

/** Create a runtime backed by the browser's built-in Prompt API. The native global is read
 *  only when a base session is created. */
export function createRuntime(options?: RuntimeOptions): Promise<Runtime> {
  return createCoreRuntime(promptApi, options);
}
