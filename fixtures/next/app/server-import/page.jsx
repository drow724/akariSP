import { createRuntime } from 'akarisp';

// Probe (spec 010 FR-1010): akarisp imported by a server component, no runtime created.
export default function ServerImport() {
  return <p id="type">{typeof createRuntime}</p>;
}
