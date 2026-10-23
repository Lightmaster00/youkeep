<template>
  <div class="discover-page">
    <h1 class="page-title discover-title">{{ t('nav.discover') }}</h1>

    <div v-if="!loaded" class="discover-status">{{ t('common.loadingDots') }}</div>

    <template v-else>
      <DiscoverRow v-if="user && (mixes.length > 0 || radioSeed)" :title="t('music.discover.madeForYou')">
        <MusicMixTile
          v-for="mix in mixes"
          :key="mix.key"
          :title="mixTitle(mix)"
          :count="mix.tracks.length"
          @play="playAll(mix.tracks)"
        />
        <MusicMixTile v-if="radioSeed" :title="t('music.mix.radio')" :subtitle="t('music.mix.radioFrom', { title: radioSeed.title })" @play="playRadio" />
      </DiscoverRow>

      <DiscoverRow v-if="genres.length > 0" :title="t('music.discover.browseGenre')" layout="wrap">
        <MusicGenreTile v-for="g in genres" :key="g.genre" :genre="g.genre" :track-count="g.trackCount" />
      </DiscoverRow>

      <DiscoverRow v-if="albums.length > 0" :title="t('music.discover.newAlbums')">
        <MusicAlbumTile v-for="album in albums" :key="album.id" :album="album" />
      </DiscoverRow>

      <DiscoverRow v-if="user && artists.length > 0" :title="t('music.discover.artists')">
        <MusicArtistTile v-for="artist in artists" :key="artist.id" :artist="artist" />
      </DiscoverRow>

      <EmptyState
        v-if="isEmpty"
        icon="music"
        :title="t('music.discover.emptyTitle')"
        :description="t('music.discover.emptyDesc')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useMusicDiscover } from '~/composables/useMusicDiscover';
import { usePlayTrackList } from '~/composables/usePlayTrackList';
import { useToast } from '~/composables/useToast';
import type { DiscoverMix } from '~/composables/useMusicDiscover';

const { t } = useI18n();
useHead({ title: computed(() => t('music.head.discover')) });

// Music Discover: personal mixes and artists to explore (logged in), genres
// and new albums (everyone). Empty rows are left out.
const { user } = useAuth();
const toast = useToast();
const { mixes, genres, albums, artists, loaded, load } = useMusicDiscover();
const { playAll, currentTrack } = usePlayTrackList();

function mixTitle(mix: DiscoverMix): string {
  switch (mix.key) {
    case 'liked': return t('music.mix.liked');
    case 'most-played': return t('music.mix.mostPlayed');
    case 'artist': return t('music.mix.artist', { name: mix.artistName ?? '' });
    default: return t('music.mix.rediscover');
  }
}

// The radio starts from the track in the player (the last one played).
const radioSeed = computed(() => (currentTrack.value?.id ? currentTrack.value : null));

const isEmpty = computed(() =>
  genres.value.length === 0 && albums.value.length === 0
  && (!user.value || (mixes.value.length === 0 && !radioSeed.value && artists.value.length === 0))
);

async function playRadio() {
  const seed = radioSeed.value;
  if (!seed) return;
  try {
    const data = await $fetch<{ tracks: any[] }>('/api/music/playlists/radio', { params: { trackId: seed.id } });
    if (data?.tracks?.length) {
      playAll(data.tracks);
      return;
    }
  } catch {
    // Reported below.
  }
  toast.error(t('music.mix.radioFailed'));
}

onMounted(load);
</script>

<style scoped>
.discover-title { margin-bottom: 20px; }

.discover-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}
</style>
