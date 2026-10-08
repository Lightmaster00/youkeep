<template>
  <NuxtLink :to="`/music/genre/${encodeURIComponent(genre)}`" class="genre-tile">
    <span class="genre-tile-name">{{ genre }}</span>
    <span class="genre-tile-meta">{{ trackCount === 1 ? '1 track' : `${trackCount} tracks` }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
// One "Browse by genre" tile of the Music Discover page; opens the genre page.
defineProps<{ genre: string; trackCount: number }>();
</script>

<style scoped>
.genre-tile {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2px;
  min-width: 0;
  min-height: 72px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-md);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.22), rgba(17, 17, 34, 0.4));
  color: inherit;
  text-decoration: none;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.genre-tile:hover,
.genre-tile:focus-visible {
  border-color: rgba(139, 92, 246, 0.5);
  transform: translateY(-2px);
}

.genre-tile-name {
  font-size: 15px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.genre-tile-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
