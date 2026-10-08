<template>
  <section class="discover-row" :aria-label="title">
    <h2 class="discover-row-title">{{ title }}</h2>
    <div v-if="layout === 'wrap'" class="discover-row-wrap">
      <slot />
    </div>
    <div v-else-if="layout === 'list'" class="discover-row-list">
      <slot />
    </div>
    <div v-else class="discover-row-scroll">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
// One titled row of a Discover page. `scroll` (default) lays its tiles out in
// a horizontal scroller, `wrap` in a wrapping grid, `list` one per line.
withDefaults(defineProps<{ title: string; layout?: 'scroll' | 'wrap' | 'list' }>(), { layout: 'scroll' });
</script>

<style scoped>
.discover-row {
  margin-bottom: 32px;
  min-width: 0;
}

.discover-row-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 12px;
  overflow-wrap: anywhere;
}

.discover-row-scroll {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 4px 0 8px;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.discover-row-scroll > :deep(*) {
  flex: 0 0 180px;
  min-width: 0;
  scroll-snap-align: start;
}

.discover-row-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.discover-row-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

@media (max-width: 560px) {
  .discover-row-scroll > :deep(*) {
    flex-basis: 150px;
  }

  .discover-row-wrap {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
}
</style>
