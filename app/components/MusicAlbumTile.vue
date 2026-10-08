<template>
  <NuxtLink :to="{ path: '/music', query: { artistId: album.artist_id } }" class="album-tile">
    <img :src="album.cover_url || fallbackCover" class="album-tile-cover" alt="" loading="lazy" @error="onCoverError" />
    <span class="album-tile-title">{{ album.title }}</span>
    <span class="album-tile-meta">{{ album.artist_name }}<template v-if="album.release_year"> · {{ album.release_year }}</template></span>
    <span class="album-tile-meta">{{ album.trackCount === 1 ? '1 track' : `${album.trackCount} tracks` }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
// One "New albums" tile of the Music Discover page; opens the album's artist
// in the Library.
defineProps<{ album: any }>();

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><circle cx=\'12\' cy=\'12\' r=\'3\'></circle></svg>';

function onCoverError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) target.src = fallbackCover;
}
</script>

<style scoped>
.album-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.album-tile-cover {
  width: 100%;
  aspect-ratio: 1;
  margin-bottom: 6px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  background: rgba(255, 255, 255, 0.04);
  transition: transform 0.2s ease;
}

.album-tile:hover .album-tile-cover,
.album-tile:focus-visible .album-tile-cover {
  transform: translateY(-3px);
}

.album-tile-title {
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.album-tile-meta {
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
</style>
