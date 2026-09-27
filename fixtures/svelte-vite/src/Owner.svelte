<script>
  import { onMount } from 'svelte';
  import { createRuntime } from 'akarisp';

  // Ownership (spec 010): create on mount, shut down in its cleanup, including a runtime
  // whose creation resolves after unmount (fixed pattern, T015).
  let runtime = $state.raw(null);
  let state = $state('none');
  let out = $state('');

  onMount(() => {
    let cancelled = false; // set by cleanup; a runtime resolving afterwards is shut down at once
    createRuntime().then((r) => {
      console.info('akarisp:create');
      if (cancelled) {
        r.shutdown().then(() => console.info('akarisp:shutdown'));
        return;
      }
      runtime = r;
      state = r.state;
    });
    return () => {
      cancelled = true;
      runtime?.shutdown().then(() => console.info('akarisp:shutdown'));
    };
  });

  async function run() {
    const { output } = await runtime.run('hi');
    out += output;
  }

  async function stream() {
    try {
      for await (const chunk of runtime.stream('hi')) out += chunk;
    } catch {} // cancelled by unmount/shutdown
  }
</script>

<div>
  <button id="run" onclick={run}>run</button>
  <button id="stream" onclick={stream}>stream</button>
  <span id="state">{state}</span>
  <pre id="out">{out}</pre>
</div>
