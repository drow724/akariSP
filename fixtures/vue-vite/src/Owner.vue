<script setup>
import { onBeforeUnmount, onMounted, shallowRef, ref } from "vue";
import { createRuntime } from "akarisp";

// Ownership (spec 010): create on mount, shut down before unmount, including a runtime
// whose creation resolves after unmount (fixed pattern, T015).
const runtime = shallowRef(null);
const state = ref("none");
const out = ref("");

let cancelled = false; // set before unmount; a runtime resolving afterwards is shut down at once

onMounted(async () => {
  const r = await createRuntime();
  console.info("akarisp:create");
  if (cancelled) {
    r.shutdown().then(() => console.info("akarisp:shutdown"));
    return;
  }
  runtime.value = r;
  state.value = r.state;
});

onBeforeUnmount(() => {
  cancelled = true;
  runtime.value?.shutdown().then(() => console.info("akarisp:shutdown"));
});

async function run() {
  const { output } = await runtime.value.run("hi");
  out.value += output;
}

async function stream() {
  try {
    for await (const chunk of runtime.value.stream("hi")) out.value += chunk;
  } catch {} // cancelled by unmount/shutdown
}
</script>

<template>
  <div>
    <button id="run" @click="run">run</button>
    <button id="stream" @click="stream">stream</button>
    <span id="state">{{ state }}</span>
    <pre id="out">{{ out }}</pre>
  </div>
</template>
