<template>
  <NuxtLayout>
    <NuxtPage :transition="{ name: 'page', mode: 'out-in' }" />
  </NuxtLayout>
  <ConfirmHost />
  <ClipboardFallbackHost />
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { serviceWorkerUrl } from '~/utils/clientCaches';

const config = useRuntimeConfig();
const { locale } = useI18n();

useHead({ htmlAttrs: { lang: computed(() => locale.value), dir: 'ltr' } });

// "Channels — YouKeep"; a page without a title of its own is just "YouKeep".
useHead({
  titleTemplate: (title?: string) => (title && title !== 'YouKeep' ? `${title} — YouKeep` : 'YouKeep'),
});

onMounted(() => {
  // Not in development: Vite serves unhashed /_nuxt/ files there.
  if (import.meta.dev || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(serviceWorkerUrl(String(config.public.buildId || '')))
    .catch(err => console.error('Service Worker registration failed', err));
});
</script>

