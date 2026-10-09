<template>
  <div class="map">
    <NuxtLink to="/music" class="btn btn-secondary map-back">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      Music
    </NuxtLink>

    <div v-if="pending" class="map-status">Loading...</div>
    <div v-else-if="failed || !overview" class="map-status">Artist not found or access denied.</div>

    <template v-else>
      <MusicArtistHeader
        :artist="overview.artist"
        :counts="overview.counts"
        :can-play="overview.counts.tracks > 0"
        @play="playArtist(false)"
        @shuffle="playArtist(true)"
      />

      <div class="map-tabs" role="tablist" aria-label="Artist sections">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          role="tab"
          class="map-tab"
          :class="{ active: tab === t.key }"
          :aria-selected="tab === t.key"
          :data-testid="`artist-tab-${t.key}`"
          @click="selectTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <EmptyState
        v-if="overview.counts.tracks === 0"
        icon="music"
        title="No tracks archived"
        description="No completed tracks for this artist yet."
      />

      <template v-else>
        <MusicArtistOverview
          v-if="tab === 'overview'"
          :overview="overview"
          @show-songs="selectTab('songs')"
          @edit="openTrackEdit"
        />

        <div v-else-if="tab === 'albums'" class="map-albums">
          <DiscoverRow v-if="overview.albums.length > 0" title="Albums" layout="wrap">
            <MusicAlbumTile v-for="album in overview.albums" :key="album.id" :album="album" :show-artist="false" />
          </DiscoverRow>
          <DiscoverRow v-if="overview.singles.length > 0" title="Singles & EPs" layout="wrap">
            <MusicAlbumTile v-for="album in overview.singles" :key="album.id" :album="album" :show-artist="false" />
          </DiscoverRow>
          <EmptyState
            v-if="overview.albums.length === 0 && overview.singles.length === 0"
            icon="music"
            title="No albums yet"
            description="This artist's songs are listed in the Songs tab."
          />
        </div>

        <!-- Kept alive once opened so going back to it keeps the loaded pages. -->
        <MusicArtistSongs
          v-if="songsOpened"
          v-show="tab === 'songs'"
          :artist-id="artistId"
          @edit="openTrackEdit"
        />
      </template>
    </template>

    <MusicTrackEditModal
      :show="!!editingTrack"
      :track="editingTrack"
      @close="editingTrack = null"
      @saved="handleTrackSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlayTrackList } from '~/composables/usePlayTrackList';

// The artist page (/music?artistId=<id>): header with Play / Shuffle, then the
// Overview, Albums and Songs tabs. The tab lives in the URL as `&tab=`.
const props = defineProps<{ artistId: string }>();

type ArtistTab = 'overview' | 'albums' | 'songs';
const TABS: Array<{ key: ArtistTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'albums', label: 'Albums' },
  { key: 'songs', label: 'Songs' },
];
// The header's Play / Shuffle queue: the artist's songs, most popular first.
const PLAY_QUEUE_LIMIT = 200;

const route = useRoute();
const router = useRouter();
const { playAll, shuffleAll } = usePlayTrackList();

const overview = ref<any>(null);
const pending = ref(true);
const failed = ref(false);
const editingTrack = ref<any>(null);

const tabFromQuery = (value: unknown): ArtistTab =>
  TABS.some((t) => t.key === value) ? (value as ArtistTab) : 'overview';

const tab = computed(() => tabFromQuery(route.query.tab));
const songsOpened = ref(tab.value === 'songs');
watch(tab, (value) => {
  if (value === 'songs') songsOpened.value = true;
});

function selectTab(next: ArtistTab) {
  if (next === tab.value) return;
  router.replace({ query: { ...route.query, tab: next === 'overview' ? undefined : next } });
}

async function load() {
  pending.value = true;
  failed.value = false;
  try {
    overview.value = await $fetch<any>(`/api/music/artists/${props.artistId}/overview`);
  } catch {
    overview.value = null;
    failed.value = true;
  } finally {
    pending.value = false;
  }
}

let playRequestId = 0;

async function playArtist(shuffle: boolean) {
  const id = ++playRequestId;
  try {
    const data = await $fetch<any>(`/api/music/artists/${props.artistId}/songs`, {
      params: { sort: 'popular', limit: PLAY_QUEUE_LIMIT, offset: 0 }
    });
    if (id !== playRequestId) return;
    const list = data?.items || [];
    if (shuffle) shuffleAll(list);
    else playAll(list);
  } catch {
    // Best effort, like the other "play a collection" buttons.
  }
}

function openTrackEdit(track: any) {
  editingTrack.value = track;
}

function handleTrackSaved(updated: any) {
  if (editingTrack.value) Object.assign(editingTrack.value, updated);
  editingTrack.value = null;
}

onMounted(load);
</script>

<style scoped>
.map {
  min-width: 0;
}

.map-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 20px;
}

.map-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.map-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.map-tab {
  flex-shrink: 0;
  padding: 10px 16px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.map-tab:hover {
  color: var(--text-primary);
}

.map-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-primary);
}
</style>
