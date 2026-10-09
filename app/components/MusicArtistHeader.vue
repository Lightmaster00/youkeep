<template>
  <div class="mah" :class="{ 'has-banner': !!artist.banner_url }">
    <img v-if="artist.banner_url" :src="artist.banner_url" class="mah-banner" alt="" @error="hideBanner" />
    <MusicCollectionHeader
      kicker="Artist"
      :subtitle="countsLabel"
      :can-play="canPlay"
      @play="emit('play')"
      @shuffle="emit('shuffle')"
    >
      <template #art>
        <img :src="artist.avatar_url || fallbackAvatar" class="mah-avatar" alt="" @error="onAvatarError" />
      </template>
      <template #title>
        <div class="mah-title-row">
          <h1 class="page-title mah-name">{{ artist.name }}</h1>
          <span v-if="isAdmin" class="badge" :class="visibilityBadgeClass(artist.visibility)">{{ formatVisibility(artist.visibility) }}</span>
        </div>
        <p v-if="artist.description" class="mah-desc">{{ artist.description }}</p>
      </template>
    </MusicCollectionHeader>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { formatVisibility, visibilityBadgeClass } from '~/utils/musicVisibilityBadge';

// Top of the artist page: banner (when the artist has one), avatar, name,
// counts and the Play / Shuffle buttons.
const props = defineProps<{
  artist: any;
  counts: { tracks: number; albums: number; singles: number } | null;
  canPlay: boolean;
}>();
const emit = defineEmits<{ play: []; shuffle: [] }>();

const { isAdmin } = useAuth();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const countsLabel = computed(() => {
  const c = props.counts;
  if (!c) return '';
  const parts = [plural(c.tracks, 'song', 'songs')];
  if (c.albums > 0) parts.push(plural(c.albums, 'album', 'albums'));
  if (c.singles > 0) parts.push(plural(c.singles, 'single or EP', 'singles and EPs'));
  return parts.join(' · ');
});

const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>';

function onAvatarError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackAvatar) target.src = fallbackAvatar;
}

function hideBanner(event: Event) {
  (event.target as HTMLElement).style.display = 'none';
}
</script>

<style scoped>
.mah-banner {
  display: block;
  width: 100%;
  height: 160px;
  object-fit: cover;
  border-radius: var(--border-radius-lg);
  margin-bottom: var(--space-4);
}

.mah :deep(.mch-art) {
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
}

.mah-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mah-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mah-name {
  margin: 0;
  overflow-wrap: anywhere;
}

.mah-desc {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (max-width: 560px) {
  .mah-banner {
    height: 96px;
  }
}
</style>
