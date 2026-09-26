// Internal session contract the core runtime calls. Not public; see specs/005 research B2.
export interface Session {
  clone(options?: { signal?: AbortSignal }): Promise<Session>;
  prompt(input: Prompt, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming(input: Prompt, options?: { signal?: AbortSignal }): AsyncIterable<string>;
  destroy(): void;
}
export interface SessionProvider { create(config?: object): Promise<Session>; }

type Prompt = string | readonly object[];

/** A waiting task's single exit: removes its abort listener, records queueWait, then starts
 *  the task (no code) or rejects it. */
type Leave = (code?: 'cancelled' | 'broken' | 'closed', cause?: unknown) => void;

export interface RuntimeOptions {
  /** Passed unchanged to the session provider's create() for the unnamed default template. */
  session?: object;
  /** Named templates: name → options passed unchanged to the session provider's create(). Fixed for the
   *  runtime's lifetime. If given without `session`, there is no default template. */
  templates?: Record<string, object>;
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
  run(input: Prompt, options?: { signal?: AbortSignal; template?: string }): Promise<TaskResult>;
  /** Same lifecycle as run(), output as chunks. Lazy: nothing is admitted until the first
   *  pull. Single-use. Leaving the loop early destroys the clone before the loop exits. */
  stream(input: Prompt, options?: { signal?: AbortSignal; template?: string }): TaskStream;
  /** Synchronous, read-only view of current state. Never waits, never changes anything. */
  snapshot(): RuntimeSnapshot;
  /** Reject waiters, cancel running tasks, destroy all sessions. Idempotent and safe to
   *  call concurrently; never rejects. Resolves only after all cleanup is done. */
  shutdown(): Promise<void>;
}

export interface RuntimeSnapshot {
  state: Runtime['state'];
  /** Tasks holding a concurrency slot (clone → prompt → task session destroyed). */
  active: number;
  /** Tasks waiting for a slot. */
  queued: number;
  limit: number;
  queueCapacity: number;
}

export interface TaskStream extends AsyncIterable<string> {
  /** undefined until the task has ended and its resources are cleaned up. */
  readonly timing: TaskTiming | undefined;
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

export async function createCoreRuntime(provider: SessionProvider, options: RuntimeOptions = {}): Promise<Runtime> {
  const { session, templates, limit = 1, queueCapacity = 32 } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be an integer >= 1');
  if (!Number.isInteger(queueCapacity) || queueCapacity < 0) {
    throw new TypeError('queueCapacity must be a finite integer >= 0');
  }
  if (templates && Object.keys(templates).length === 0 && session === undefined) {
    throw new TypeError('templates is empty and no session was given');
  }
  // One warm base per template; key undefined = unnamed default. Fixed after creation.
  const bases = new Map<string | undefined, Session>();
  try {
    // ponytail: sequential creation scales startup with template count; use Promise.allSettled
    // if startup latency matters.
    if (templates === undefined || session !== undefined) bases.set(undefined, await provider.create(session));
    for (const [name, config] of Object.entries(templates ?? {})) bases.set(name, await provider.create(config));
  } catch (e) {
    for (const b of bases.values()) try { b.destroy(); } catch {}
    throw e;
  }
  const pick = (template?: string) => {
    const base = bases.get(template);
    if (base) return base;
    throw new TypeError(template === undefined
      ? 'template is required: this runtime has no default session'
      : `unknown template "${template}"`);
  };
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

  // --- Task lifecycle shared by run() and stream() --------------------------------------

  // State and pre-abort checks, then a slot now or a FIFO wait. Sets `total` on its errors.
  const admit = async (signal: AbortSignal | undefined) => {
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
    // Now a running task holding a slot; the caller must end() it.
    const sig = signal ? AbortSignal.any([signal, closer.signal]) : closer.signal;
    return { t0, timing, sig };
  };

  // Errors thrown while running leave `total` to end().
  const failure = (sig: AbortSignal, timing: TaskTiming, e: unknown) =>
    sig.aborted ? new TaskError('cancelled', timing, sig.reason) : new TaskError('failed', timing, e);

  const acquire = async (base: Session, sig: AbortSignal, timing: TaskTiming) => {
    if (sig.aborted) throw new TaskError('cancelled', timing, sig.reason);
    if (state === 'broken') throw new TaskError('broken', timing); // broke while this task waited
    const t1 = performance.now();
    let task: Session;
    try {
      task = await base.clone({ signal: sig });
    } catch (e) {
      // ponytail: InvalidStateError = base no longer trusted (research R2); revisit if the
      // Prompt API spec defines destroyed-session errors differently.
      if (!sig.aborted && e instanceof DOMException && e.name === 'InvalidStateError') {
        if (state === 'ready') {
          state = 'broken';
          drain('broken');
        }
        throw new TaskError('broken', timing, e);
      }
      throw failure(sig, timing, e);
    }
    timing.acquire = performance.now() - t1;
    return task; // caller owns it before checking sig.aborted, so end() destroys a late clone
  };

  // Destroy → release slot → total. Runs before the task's outcome settles (FR-009b).
  const end = (task: Session | undefined, t0: number, timing: TaskTiming) => {
    try { task?.destroy(); } catch {}
    release();
    timing.total = performance.now() - t0;
  };

  return {
    get state() { return state; },

    snapshot: () => ({ state, active: running, queued: queue.length, limit, queueCapacity }),

    async run(input, { signal, template } = {}) {
      const base = pick(template); // before admission: a bad template consumes nothing
      const { t0, timing, sig } = await admit(signal);
      let task: Session | undefined;
      try {
        task = await acquire(base, sig, timing);
        if (sig.aborted) throw new TaskError('cancelled', timing, sig.reason);
        const t2 = performance.now();
        const output = await task.prompt(input, { signal: sig }).catch((e) => { throw failure(sig, timing, e); });
        timing.prompt = performance.now() - t2;
        return { output, timing };
      } finally {
        end(task, t0, timing);
      }
    },

    stream(input, { signal, template } = {}) {
      let used = false;
      const s = {
        timing: undefined as TaskTiming | undefined,
        // Async generator: nothing runs before the first pull (lazy), and `break`/return()
        // runs `finally` and cancels the provider stream before the loop exit completes.
        async *[Symbol.asyncIterator]() {
          if (used) throw new TypeError('stream already consumed');
          used = true;
          const base = pick(template); // first pull, before admission
          const { t0, timing, sig } = await admit(signal).catch((e: TaskError) => {
            s.timing = e.timing;
            throw e;
          });
          let task: Session | undefined;
          let onAbort: (() => void) | undefined; // declared before cleanup, which reads it
          let cleaning: Promise<void> | undefined;
          // Single-flight: every caller awaits the same cleanup.
          const cleanup = () => (cleaning ??= (async () => {
            if (onAbort) sig.removeEventListener('abort', onAbort);
            end(task, t0, timing);
            s.timing = timing;
          })());
          try {
            task = await acquire(base, sig, timing);
            if (sig.aborted) throw new TaskError('cancelled', timing, sig.reason);
            // The consumer may stop pulling while paused at `yield`; clean up on abort anyway.
            onAbort = () => void cleanup();
            sig.addEventListener('abort', onAbort, { once: true });
            const t2 = performance.now();
            try {
              for await (const chunk of task.promptStreaming(input, { signal: sig })) {
                yield chunk;
                if (sig.aborted) throw sig.reason; // resumed after abort; mapped below
              }
            } catch (e) {
              throw failure(sig, timing, e);
            }
            timing.prompt = performance.now() - t2;
          } finally {
            await cleanup();
          }
        },
      };
      return s;
    },

    shutdown() {
      // Stored synchronously, so repeated and concurrent calls share one cleanup.
      return (closing ??= (async () => {
        state = 'closed';
        drain('closed');
        closer.abort(new DOMException('Runtime closed', 'AbortError'));
        if (running) await new Promise<void>((resolve) => { idle = resolve; });
        for (const b of bases.values()) try { b.destroy(); } catch {}
      })());
    },
  };
}
