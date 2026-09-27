<script setup>
import { ref } from 'vue';
import Owner from './Owner.vue';

const mounted = ref(true);
</script>

<template>
  <button id="toggle" @click="mounted = !mounted">toggle</button>
  <Owner v-if="mounted" />
</template>
