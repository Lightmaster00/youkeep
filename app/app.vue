<template>
  <NuxtLayout>
    <NuxtPage :transition="{ name: 'page', mode: 'out-in' }" />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { serviceWorkerUrl } from '~/utils/clientCaches';

const config = useRuntimeConfig();

onMounted(() => {
  // Not in development: Vite serves unhashed /_nuxt/ files there.
  if (import.meta.dev || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(serviceWorkerUrl(String(config.public.buildId || '')))
    .catch(err => console.error('Service Worker registration failed', err));
});
</script>

