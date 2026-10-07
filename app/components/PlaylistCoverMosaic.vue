<template>
  <div class="cover-mosaic" :class="`count-${tiles.length}`" aria-hidden="true">
    <img v-for="(url, i) in tiles" :key="i" :src="url" alt="" loading="lazy" />
    <svg v-if="tiles.length === 0" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// Square playlist cover: a 2x2 grid of the first four track covers, the first
// cover alone when there are fewer, or a placeholder for an empty playlist.
const props = defineProps<{ urls?: string[] }>();
const tiles = computed(() => {
  const urls = (props.urls ?? []).filter(Boolean);
  return urls.length >= 4 ? urls.slice(0, 4) : urls.slice(0, 1);
});
</script>

<style scoped>
.cover-mosaic {
  width: 100%;
  aspect-ratio: 1;
  display: grid;
  overflow: hidden;
  border-radius: var(--border-radius-md);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.35), rgba(236, 72, 153, 0.25));
  color: rgba(255, 255, 255, 0.85);
  place-items: center;
}

.cover-mosaic.count-4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.cover-mosaic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
