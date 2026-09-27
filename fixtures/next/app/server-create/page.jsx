import { createRuntime } from 'akarisp';

// Probe (spec 010 FR-1010/FR-1012): a runtime created in a server component. Observed, not
// recommended. Request-time only, so it cannot fail the build.
export const dynamic = 'force-dynamic';

export default async function ServerCreate() {
  const runtime = await createRuntime();
  return <p>{runtime.state}</p>;
}
