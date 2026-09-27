// Type-checked against the packed tarball by test/package.test.ts; never executed.
import { createRuntime, TaskError, type Runtime, type RuntimeOptions, type RuntimeSnapshot, type TaskResult, type TaskStream, type TaskTiming } from 'akarisp';

const options: RuntimeOptions = { session: {}, templates: { risk: {} }, limit: 2, queueCapacity: 8 };
const runtime: Runtime = await createRuntime(options);
const result: TaskResult = await runtime.run('hi', { signal: AbortSignal.timeout(1000), template: 'risk' });
const output: string = result.output;
const stream: TaskStream = runtime.stream([{ role: 'user', content: 'hi' }]);
for await (const chunk of stream) output.concat(chunk);
const timing: TaskTiming | undefined = stream.timing;
const snapshot: RuntimeSnapshot = runtime.snapshot();
// @ts-expect-error RuntimeSnapshot is read-only
snapshot.active = 0;
try {
  await runtime.run('hi');
} catch (e) {
  if (e instanceof TaskError) {
    const code: 'failed' | 'cancelled' | 'rejected' | 'closed' | 'broken' = e.code;
    const total: number = e.timing.total;
  }
}
const state: 'ready' | 'broken' | 'closed' = runtime.state;
await runtime.shutdown();
export { timing, state };
