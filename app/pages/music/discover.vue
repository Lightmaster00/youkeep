<template>
  <div class="discover-page">
    <h1 class="page-title discover-title">Discover</h1>

    <div v-if="!loaded" class="discover-status">Loading...</div>

    <template v-else>
      <DiscoverRow v-if="user && (mixes.length > 0 || radioSeed)" title="Made for you">
        <MusicMixTile
          v-for="mix in mixes"
          :key="mix.key"
          :title="mix.title"
          :count="mix.tracks.length"
          @play="playAll(mix.tracks)"
        />
        <MusicMixTile v-if="radioSeed" title="Radio" :subtitle="`From ${radioSeed.title}`" @play="playRadio" />
      </DiscoverRow>

      <DiscoverRow v-if="genres.length > 0" title="Browse by genre" layout="wrap">
        <MusicGenreTile v-for="g in genres" :key="g.genre" :genre="g.genre" :track-count="g.trackCount" />
      </DiscoverRow>

      <DiscoverRow v-if="albums.length > 0" title="New albums">
        <MusicAlbumTile v-for="album in albums" :key="album.id" :album="album" />
      </DiscoverRow>

      <DiscoverRow v-if="user && artists.length > 0" title="Artists to explore">
        <MusicArtistTile v-for="artist in artists" :key="artist.id" :artist="artist" />
      </DiscoverRow>

      <EmptyState
        v-if="isEmpty"
        icon="music"
        title="Nothing to discover yet"
        description="Genres, albums and mixes appear here once tracks are downloaded."
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

// Music Discover: personal mixes and artists to explore (logged in), genres
// and new albums (everyone). Empty rows are left out.
const { user } = useAuth();
const toast = useToast();
const { mixes, genres, albums, artists, loaded, load } = useMusicDiscover();
const { playAll, currentTrack } = usePlayTrackList();

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
  toast.error('Could not start the radio.');
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
