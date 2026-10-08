<template>
  <button type="button" class="mix-tile" :aria-label="`Play ${title}`" @click="emit('play')">
    <span class="mix-tile-art" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
    </span>
    <span class="mix-tile-title">{{ title }}</span>
    <span v-if="subtitle" class="mix-tile-meta">{{ subtitle }}</span>
    <span v-else-if="count != null" class="mix-tile-meta">{{ count === 1 ? '1 track' : `${count} tracks` }}</span>
  </button>
</template>

<script setup lang="ts">
// One "Made for you" mix of the Music Discover page; clicking plays it. The
// meta line is `subtitle` when given, else the track count.
defineProps<{ title: string; count?: number; subtitle?: string }>();
const emit = defineEmits<{ play: [] }>();
</script>

<style scoped>
.mix-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.mix-tile-art {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  margin-bottom: 6px;
  border-radius: var(--border-radius-md);
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: rgba(255, 255, 255, 0.92);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.mix-tile:hover .mix-tile-art,
.mix-tile:focus-visible .mix-tile-art {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}

.mix-tile-title {
  max-width: 100%;
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.mix-tile-meta {
  max-width: 100%;
  font-size: 13px;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}
</style>
