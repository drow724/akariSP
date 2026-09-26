// Minimal shape of Chrome's Prompt API that AkariSP uses (research R1). Not a provider abstraction.
interface Session {
  clone(options?: { signal?: AbortSignal }): Promise<Session>;
  prompt(input: Prompt, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
declare const LanguageModel: { create(options?: object): Promise<Session> };

type Prompt = string | readonly object[];

/** A waiting task's single exit: removes its abort listener, records queueWait, then starts
 *  the task (no code) or rejects it. */
type Leave = (code?: 'cancelled' | 'broken' | 'closed', cause?: unknown) => void;

export interface RuntimeOptions {
  /** Passed unchanged to LanguageModel.create() for the base session. */
  session?: object;
  /** Absolute cap on running tasks (slot acquire → clone → prompt → destroy → release).
   *  Integer ≥ 1. Default 1. */
  limit?: number;
  /** Max waiting tasks. Finite integer ≥ 0. Default 32.
   *  When limit is reached and the queue is full, run() rejects. */
  queueCapacity?: number;
}

export interface Runtime {
  readonly state: 'ready' | 'broken' | 'closed';
  /** Clone base → prompt → destroy clone. */
  run(input: Prompt, options?: { signal?: AbortSignal }): Promise<TaskResult>;
  /** Reject waiters, cancel running tasks, destroy all sessions. Idempotent and safe to
   *  call concurrently; never rejects. Resolves only after all cleanup is done. */
  shutdown(): Promise<void>;
}

export interface TaskResult {
  output: string;
  timing: TaskTiming;
}

/** Milliseconds. A field is set only if its phase completed; total is always set. */
export interface TaskTiming {
  queueWait?: number;
  acquire?: number;
  prompt?: number;
  total: number;
}

export class TaskError extends Error {
  readonly code: 'failed' | 'cancelled' | 'rejected' | 'closed' | 'broken';
  readonly timing: TaskTiming;
  constructor(code: TaskError['code'], timing: TaskTiming, cause?: unknown) {
    super(`Task ${code}`, { cause });
    this.name = 'TaskError';
    this.code = code;
    this.timing = timing;
  }
}

export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const { session, limit = 1, queueCapacity = 32 } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be an integer >= 1');
  if (!Number.isInteger(queueCapacity) || queueCapacity < 0) {
    throw new TypeError('queueCapacity must be a finite integer >= 0');
  }
  const base = await LanguageModel.create(session);
  let state: Runtime['state'] = 'ready';
  const closer = new AbortController();
  let running = 0;
  const queue: Leave[] = [];
  let closing: Promise<void> | undefined;
  let idle: (() => void) | undefined;

  const drain = (code: 'broken' | 'closed') => {
    while (queue.length) queue.shift()!(code);
  };
  // Called only after the task session is destroyed, so `limit` also caps live task sessions.
  const release = () => {
    running--;
    if (state === 'ready' && queue.length) {
      running++;
      queue.shift()!();
    }
    if (running === 0) idle?.();
  };

  return {
    get state() { return state; },

    async run(input, { signal } = {}) {
      const t0 = performance.now();
      const timing: TaskTiming = { total: 0 };
      const fail = (code: TaskError['code'], cause?: unknown) => {
        timing.total = performance.now() - t0;
        return new TaskError(code, timing, cause);
      };
      if (state !== 'ready') throw fail(state);
      if (signal?.aborted) throw fail('cancelled', signal.reason);

      if (running < limit) {
        running++;
        timing.queueWait = 0;
      } else if (queue.length < queueCapacity) {
        await new Promise<void>((resolve, reject) => {
          const leave: Leave = (code, cause) => {
            signal?.removeEventListener('abort', onAbort);
            timing.queueWait = performance.now() - t0;
            code ? reject(fail(code, cause)) : resolve();
          };
          const onAbort = () => {
            queue.splice(queue.indexOf(leave), 1);
            leave('cancelled', signal!.reason);
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          queue.push(leave);
        });
      } else {
        throw fail('rejected');
      }

      // Running task: holds a slot; its session is destroyed and the slot released in
      // `finally`, before the outcome settles (FR-009b).
      const sig = signal ? AbortSignal.any([signal, closer.signal]) : closer.signal;
      let task: Session | undefined;
      try {
        if (sig.aborted) throw fail('cancelled', sig.reason);
        // `state` may have changed while waiting; TS keeps the pre-await narrowing.
        if ((state as Runtime['state']) === 'broken') throw fail('broken');
        const t1 = performance.now();
        try {
          task = await base.clone({ signal: sig });
        } catch (e) {
          if (sig.aborted) throw fail('cancelled', sig.reason);
          // ponytail: InvalidStateError = base no longer trusted (research R2); revisit if the
          // Prompt API spec defines destroyed-session errors differently.
          if (e instanceof DOMException && e.name === 'InvalidStateError') {
            if (state === 'ready') {
              state = 'broken';
              drain('broken');
            }
            throw fail('broken', e);
          }
          throw fail('failed', e);
        }
        timing.acquire = performance.now() - t1;
        if (sig.aborted) throw fail('cancelled', sig.reason);
        const t2 = performance.now();
        let output: string;
        try {
          output = await task.prompt(input, { signal: sig });
        } catch (e) {
          throw sig.aborted ? fail('cancelled', sig.reason) : fail('failed', e);
        }
        timing.prompt = performance.now() - t2;
        return { output, timing };
      } finally {
        try { task?.destroy(); } catch {}
        release();
        timing.total = performance.now() - t0;
      }
    },

    shutdown() {
      // Stored synchronously, so repeated and concurrent calls share one cleanup.
      return (closing ??= (async () => {
        state = 'closed';
        drain('closed');
        closer.abort(new DOMException('Runtime closed', 'AbortError'));
        if (running) await new Promise<void>((resolve) => { idle = resolve; });
        try { base.destroy(); } catch {}
      })());
    },
  };
}
