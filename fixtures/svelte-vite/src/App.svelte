<script>
  import Owner from './Owner.svelte';

  let mounted = $state(true);
</script>

<button id="toggle" onclick={() => (mounted = !mounted)}>toggle</button>
{#if mounted}<Owner />{/if}
