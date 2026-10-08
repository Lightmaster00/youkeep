<template>
  <NuxtLink :to="{ path: '/music', query: { artistId: artist.id } }" class="artist-tile">
    <img :src="artist.avatar_url || fallbackAvatar" class="artist-tile-avatar" alt="" loading="lazy" @error="onAvatarError" />
    <span class="artist-tile-name">{{ artist.name }}</span>
    <span class="artist-tile-meta">{{ artist.track_count === 1 ? '1 track' : `${artist.track_count} tracks` }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
// One "Artists to explore" tile of the Music Discover page; opens the artist
// in the Library.
defineProps<{ artist: any }>();

const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\'></path><circle cx=\'12\' cy=\'7\' r=\'4\'></circle></svg>';

function onAvatarError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackAvatar) target.src = fallbackAvatar;
}
</script>

<style scoped>
.artist-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  text-align: center;
  color: inherit;
  text-decoration: none;
}

.artist-tile-avatar {
  width: 100%;
  aspect-ratio: 1;
  margin-bottom: 6px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.04);
  transition: transform 0.2s ease;
}

.artist-tile:hover .artist-tile-avatar,
.artist-tile:focus-visible .artist-tile-avatar {
  transform: translateY(-3px);
}

.artist-tile-name {
  max-width: 100%;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.artist-tile-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
