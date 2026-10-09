<template>
  <div class="mao">
    <section v-if="overview.popular.length > 0" class="mao-section" aria-label="Popular">
      <h2 class="mao-title">Popular</h2>
      <MusicTrackList
        :tracks="overview.popular"
        :active-id="currentTrack?.id"
        @play="(track) => playFrom(track, overview.popular)"
      >
        <template #actions="{ track }">
          <MusicTrackExtras :track="track" :list="overview.popular" @edit="(t) => emit('edit', t)" />
        </template>
      </MusicTrackList>
      <button
        v-if="overview.counts.tracks > overview.popular.length"
        type="button"
        class="btn btn-secondary mao-more"
        data-testid="popular-show-more"
        @click="emit('show-songs')"
      >
        Show more
      </button>
    </section>

    <section v-if="overview.latest" class="mao-section" aria-label="Latest release">
      <h2 class="mao-title">Latest release</h2>
      <NuxtLink
        v-if="overview.latest.kind === 'album'"
        :to="`/music/album/${overview.latest.album.id}`"
        class="mao-latest"
        data-testid="latest-release"
      >
        <img :src="overview.latest.album.cover_url || fallbackCover" class="mao-latest-cover" alt="" @error="onCoverError" />
        <span class="mao-latest-text">
          <span class="mao-latest-title">{{ overview.latest.album.title }}</span>
          <span class="mao-latest-meta">{{ latestAlbumMeta }}</span>
        </span>
      </NuxtLink>
      <button
        v-else
        type="button"
        class="mao-latest"
        data-testid="latest-release"
        @click="playFrom(overview.latest.track, [overview.latest.track])"
      >
        <img :src="overview.latest.track.local_thumbnail_path || overview.latest.track.album_cover_url || fallbackCover" class="mao-latest-cover" alt="" @error="onCoverError" />
        <span class="mao-latest-text">
          <span class="mao-latest-title">{{ overview.latest.track.title }}</span>
          <span class="mao-latest-meta">Song</span>
        </span>
      </button>
    </section>

    <DiscoverRow v-if="overview.albums.length > 0" title="Albums">
      <MusicAlbumTile v-for="album in overview.albums" :key="album.id" :album="album" :show-artist="false" />
    </DiscoverRow>

    <DiscoverRow v-if="overview.singles.length > 0" title="Singles & EPs">
      <MusicAlbumTile v-for="album in overview.singles" :key="album.id" :album="album" :show-artist="false" />
    </DiscoverRow>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePlayTrackList } from '~/composables/usePlayTrackList';

// Overview tab of the artist page: Popular (5 rows, "Show more" opens the
// Songs tab), the latest release, and the Albums / Singles & EPs rows (each
// only when not empty).
const props = defineProps<{ overview: any }>();
const emit = defineEmits<{ 'show-songs': []; edit: [track: any] }>();

const { playFrom, currentTrack } = usePlayTrackList();

const TYPE_LABELS: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP' };

const latestAlbumMeta = computed(() => {
  const album = props.overview.latest?.album;
  if (!album) return '';
  return [TYPE_LABELS[album.album_type] ?? 'Album', album.release_year].filter(Boolean).join(' · ');
});

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><circle cx=\'12\' cy=\'12\' r=\'3\'></circle></svg>';

function onCoverError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) target.src = fallbackCover;
}
</script>

<style scoped>
.mao-section {
  margin-bottom: 32px;
  min-width: 0;
}

.mao-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 12px;
}

.mao-more {
  margin-top: 12px;
}

.mao-latest {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-lg);
  background: rgba(17, 17, 34, 0.4);
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.mao-latest:hover,
.mao-latest:focus-visible {
  border-color: rgba(139, 92, 246, 0.4);
}

.mao-latest-cover {
  width: 88px;
  height: 88px;
  flex-shrink: 0;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  background: rgba(255, 255, 255, 0.04);
}

.mao-latest-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mao-latest-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.mao-latest-meta {
  font-size: 13px;
  color: var(--text-secondary);
}

@media (max-width: 560px) {
  .mao-latest {
    width: 100%;
  }

  .mao-latest-cover {
    width: 64px;
    height: 64px;
  }
}
</style>
