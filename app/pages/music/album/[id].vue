<template>
  <div class="album-page">
    <NuxtLink :to="backLink" class="btn btn-secondary ap-back">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      {{ album ? album.artistName : 'Music' }}
    </NuxtLink>

    <div v-if="pending" class="ap-status">Loading...</div>
    <div v-else-if="failed || !album" class="ap-status">Album not found or access denied.</div>

    <template v-else>
      <MusicCollectionHeader
        :kicker="typeLabel"
        :subtitle="subtitle"
        :can-play="tracks.length > 0"
        @play="playAll(tracks)"
        @shuffle="shuffleAll(tracks)"
      >
        <template v-if="album.coverUrl" #art>
          <img :src="album.coverUrl" class="ap-cover" alt="" @error="hideCover" />
        </template>
        <template #title>
          <h1 class="page-title ap-title">{{ album.title }}</h1>
          <NuxtLink :to="{ path: '/music', query: { artistId: album.artistId } }" class="ap-artist" data-testid="album-artist-link">
            {{ album.artistName }}
          </NuxtLink>
        </template>
        <template v-if="isAdmin" #buttons>
          <button type="button" class="btn btn-secondary" data-testid="album-edit" @click="editingAlbum = true">Edit album</button>
        </template>
      </MusicCollectionHeader>

      <EmptyState
        v-if="tracks.length === 0"
        icon="music"
        title="No tracks downloaded"
        description="Tracks of this album appear here once they are downloaded."
      />
      <MusicTrackList
        v-else
        :tracks="tracks"
        :active-id="currentTrack?.id"
        track-numbers
        hide-album
        @play="(track) => playFrom(track, tracks)"
      >
        <template #actions="{ track }">
          <MusicTrackExtras :track="track" :list="tracks" @edit="(t) => (editingTrack = t)" />
        </template>
      </MusicTrackList>
    </template>

    <MusicTrackEditModal
      :show="!!editingTrack"
      :track="editingTrack"
      @close="editingTrack = null"
      @saved="handleTrackSaved"
    />
    <MusicAlbumEditModal
      :show="editingAlbum"
      :album="albumForEdit"
      @close="editingAlbum = false"
      @saved="handleAlbumSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { usePlayTrackList } from '~/composables/usePlayTrackList';

// One album: cover, title, type and year, artist link, Play / Shuffle and the
// tracklist in album order. Admins can edit the album and its tracks here.
definePageMeta({ key: (route) => route.fullPath });

const route = useRoute();
const { isAdmin } = useAuth();
const { playAll, shuffleAll, playFrom, currentTrack } = usePlayTrackList();

const album = ref<any>(null);
const tracks = ref<any[]>([]);
const pending = ref(true);
const failed = ref(false);
const editingTrack = ref<any>(null);
const editingAlbum = ref(false);

const TYPE_LABELS: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP' };
const typeLabel = computed(() => TYPE_LABELS[album.value?.type] ?? 'Album');
const subtitle = computed(() => {
  const count = tracks.value.length === 1 ? '1 song' : `${tracks.value.length} songs`;
  return [album.value?.year, count].filter(Boolean).join(' · ');
});
const backLink = computed(() => (album.value ? { path: '/music', query: { artistId: album.value.artistId } } : '/music'));

// The edit modal speaks the admin album route's shape.
const albumForEdit = computed(() => album.value && {
  id: album.value.id,
  title: album.value.title,
  release_year: album.value.year,
  cover_url: album.value.coverUrl,
  manual_cover_url: album.value.manualCoverUrl,
});

async function load() {
  pending.value = true;
  failed.value = false;
  try {
    const data = await $fetch<any>(`/api/music/albums/${encodeURIComponent(String(route.params.id ?? ''))}`);
    album.value = data.album;
    tracks.value = data.tracks || [];
  } catch {
    album.value = null;
    failed.value = true;
  } finally {
    pending.value = false;
  }
}

function handleTrackSaved(updated: any) {
  if (editingTrack.value) Object.assign(editingTrack.value, updated);
  editingTrack.value = null;
}

function handleAlbumSaved(updated: any) {
  if (album.value && updated) {
    album.value = {
      ...album.value,
      title: updated.title,
      year: updated.release_year,
      coverUrl: updated.cover_url,
      manualCoverUrl: updated.manual_cover_url,
    };
    for (const t of tracks.value) t.album_title = updated.title;
  }
  editingAlbum.value = false;
}

function hideCover(event: Event) {
  (event.target as HTMLElement).style.display = 'none';
}

onMounted(load);
</script>

<style scoped>
.ap-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin-bottom: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ap-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.ap-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ap-title {
  margin: 0;
  overflow-wrap: anywhere;
}

.ap-artist {
  align-self: flex-start;
  color: var(--text-primary);
  font-weight: 600;
  text-decoration: none;
  overflow-wrap: anywhere;
}

.ap-artist:hover,
.ap-artist:focus-visible {
  text-decoration: underline;
}
</style>
