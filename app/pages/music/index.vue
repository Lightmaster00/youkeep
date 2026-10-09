<template>
  <div class="music-page">
    <!-- GRID VIEW -->
    <div v-if="!artistId">
      <div class="music-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Search for an artist or a track..."
          class="form-input music-search-input"
        />
        <template v-if="!search">
          <select v-model="genre" class="form-input">
            <option value="">All genres</option>
            <option v-for="g in facets.genres" :key="g" :value="g">{{ g }}</option>
          </select>
          <select v-model="language" class="form-input">
            <option value="">All languages</option>
            <option v-for="l in facets.languages" :key="l" :value="l">{{ l }}</option>
          </select>
          <select v-model="year" class="form-input">
            <option value="">All years</option>
            <option v-for="y in facets.years" :key="y" :value="y">{{ y }}</option>
          </select>
        </template>
      </div>

      <template v-if="search">
        <div v-if="trackSearchPending" class="music-loading">Loading...</div>
        <div v-else-if="trackSearchError" class="music-error">Search failed.</div>
        <EmptyState
          v-else-if="trackSearchResults.length === 0"
          icon="music"
          title="No results"
          description="No tracks match this search."
        />
        <div v-else class="track-search-results">
          <div
            v-for="track in trackSearchResults"
            :key="track.id"
            class="track-row"
            :class="{ 'now-playing': currentTrack?.id === track.id }"
            @click="playTrackSearchResult(track)"
          >
            <span class="track-row-title" v-html="highlightMatch(track.title, search)"></span>
            <span class="track-row-artist">{{ track.artist_name }}</span>
            <MusicTrackActions :track-id="track.id" class="track-search-actions" />
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="playlists.length > 0" class="playlists-row">
          <div
            v-for="playlist in playlists"
            :key="playlist.key"
            class="playlist-card"
            @click="playPlaylist(playlist)"
          >
            <div class="playlist-card-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
            <div class="playlist-card-info">
              <h4 class="playlist-card-label">{{ playlist.label }}</h4>
              <p class="playlist-card-count">{{ playlist.tracks.length }} track(s)</p>
            </div>
          </div>
        </div>

        <div v-if="gridPending" class="music-loading">Loading...</div>

        <div v-else-if="gridError" class="music-error">Failed to load artists.</div>

        <EmptyState
          v-else-if="artists.length === 0"
          icon="music"
          :title="hasActiveFilters ? 'No results' : 'No artists archived'"
          :description="hasActiveFilters ? 'No results for these filters.' : 'No artists archived yet.'"
        />

        <div v-else class="artist-grid">
          <div
            v-for="a in artists"
            :key="a.id"
            class="artist-card"
            @click="router.push({ path: '/music', query: { artistId: a.id } })"
          >
            <img :src="a.avatar_url || fallbackAvatar" @error="handleAvatarError" class="artist-card-avatar" alt="" />
            <div class="artist-card-body">
              <h3 class="artist-card-name">{{ a.name }}</h3>
              <p class="artist-card-meta">{{ a.track_count }} track(s)</p>
              <span v-if="isAdmin" class="badge" :class="visibilityBadgeClass(a.visibility)">{{ formatVisibility(a.visibility) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ARTIST PAGE -->
    <MusicArtistPage v-else :key="artistId" :artist-id="artistId" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { highlightMatch } from '../../utils/highlightMatch';
import { formatVisibility, visibilityBadgeClass } from '../../utils/musicVisibilityBadge';

const { isAdmin } = useAuth();
const { currentTrack, play: playMusicTrack } = useMusicPlayer();
const route = useRoute();
const router = useRouter();

const artistId = computed(() => (route.query.artistId ? String(route.query.artistId) : ''));

// --- Grid view state ---
const search = ref('');
const genre = ref('');
const language = ref('');
const year = ref('');
const artists = ref<any[]>([]);
const facets = ref<{ genres: string[]; languages: string[]; years: number[] }>({ genres: [], languages: [], years: [] });
const gridPending = ref(true);
const gridError = ref(false);

const hasActiveFilters = computed(() => !!(search.value || genre.value || language.value || year.value));

// --- Automatic playlists ---
const playlists = ref<Array<{ key: string; label: string; tracks: any[] }>>([]);

async function fetchPlaylists() {
  const results: Array<{ key: string; label: string; tracks: any[] }> = [];

  try {
    const mostPlayed = await $fetch<any>('/api/music/playlists/most-played');
    if (mostPlayed.tracks?.length > 0) {
      results.push({ key: 'most-played', label: 'Most played', tracks: mostPlayed.tracks });
    }
  } catch (e) { /* silently skip this card on error */ }

  try {
    const recentlyAdded = await $fetch<any>('/api/music/playlists/recently-added');
    if (recentlyAdded.tracks?.length > 0) {
      results.push({ key: 'recently-added', label: 'Recently added', tracks: recentlyAdded.tracks });
    }
  } catch (e) { /* silently skip this card on error */ }

  try {
    const rediscover = await $fetch<any>('/api/music/playlists/rediscover');
    if (rediscover.tracks?.length > 0) {
      results.push({ key: 'rediscover', label: 'Rediscover', tracks: rediscover.tracks });
    }
  } catch (e) { /* silently skip this card on error */ }

  for (const g of facets.value.genres) {
    try {
      const genreMix = await $fetch<any>('/api/music/playlists/genre-mix', { params: { genre: g } });
      if (genreMix.tracks?.length > 0) {
        results.push({ key: `genre-${g}`, label: `Mix ${g}`, tracks: genreMix.tracks });
      }
    } catch (e) { /* silently skip this card on error */ }
  }

  playlists.value = results;
}

function playPlaylist(playlist: { tracks: any[] }) {
  if (playlist.tracks.length === 0) return;
  playMusicTrack(playlist.tracks[0], playlist.tracks);
}

let artistsRequestId = 0;

async function fetchArtists() {
  const requestId = ++artistsRequestId;
  gridPending.value = true;
  gridError.value = false;
  try {
    const params: Record<string, string> = {};
    if (search.value) params.search = search.value;
    if (genre.value) params.genre = genre.value;
    if (language.value) params.language = language.value;
    if (year.value) params.year = year.value;
    const data = await $fetch<any>('/api/music/artists', { params });
    if (requestId !== artistsRequestId) return;
    artists.value = data.artists || [];
    facets.value = data.facets || { genres: [], languages: [], years: [] };
    if (!hasActiveFilters.value && playlists.value.length === 0) {
      fetchPlaylists();
    }
  } catch (e) {
    if (requestId !== artistsRequestId) return;
    artists.value = [];
    gridError.value = true;
  } finally {
    if (requestId !== artistsRequestId) return;
    gridPending.value = false;
  }
}

const trackSearchResults = ref<any[]>([]);
const trackSearchPending = ref(false);
const trackSearchError = ref(false);
let trackSearchRequestId = 0;

async function fetchTrackSearch() {
  const requestId = ++trackSearchRequestId;
  trackSearchPending.value = true;
  trackSearchError.value = false;
  try {
    const data = await $fetch<any>('/api/music/tracks/search', { params: { q: search.value } });
    if (requestId !== trackSearchRequestId) return;
    trackSearchResults.value = data.tracks || [];
  } catch (e) {
    if (requestId !== trackSearchRequestId) return;
    trackSearchResults.value = [];
    trackSearchError.value = true;
  } finally {
    if (requestId !== trackSearchRequestId) return;
    trackSearchPending.value = false;
  }
}

function playTrackSearchResult(track: any) {
  if (!track.local_file_path) return;
  playMusicTrack(track, trackSearchResults.value);
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    if (search.value) {
      fetchTrackSearch();
    } else {
      fetchArtists();
    }
  }, 300);
});
watch([genre, language, year], () => fetchArtists());

// Keep `search` in sync with ?q= so the header search bar's navigation to
// /music?q=<term> (both in per_space mode, and via /search's "Voir plus de
// musique" link) actually triggers a search — Vue Router does not remount
// this component for a query-only navigation to the same route, so this
// must be a watcher, not just an onMounted read.
watch(
  () => route.query.q,
  (newQ) => {
    const newSearch = newQ ? String(newQ) : '';
    if (newSearch !== search.value) {
      search.value = newSearch;
    }
  },
  { immediate: true }
);

// The artist page (MusicArtistPage) loads itself; the library grid is
// (re)loaded when it is shown.
watch(artistId, (newId, oldId) => {
  if (!newId && oldId) fetchArtists();
});

onMounted(() => {
  if (!artistId.value) fetchArtists();
});

const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>';

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackAvatar) {
    target.src = fallbackAvatar;
  }
};
</script>

<style scoped>
.music-filters-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.music-search-input {
  flex: 1;
  /* min-width: 200px was a hard floor that exceeded the filters bar's own
     content box (192px) at a 320px viewport, even though the input already
     sits alone on its wrapped line. flex: 1 already sizes it sensibly at
     every wider width — dropping the floor lets it shrink the last few
     pixels instead of overflowing. */
  min-width: 0;
}

.music-filters-bar select.form-input {
  width: auto;
  flex: 0 1 auto;
  min-width: 150px;
}

.playlists-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  margin-bottom: 24px;
  padding-bottom: 4px;
}

.playlist-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: rgba(139, 92, 246, 0.08);
  flex-shrink: 0;
  min-width: 220px;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.playlist-card:hover {
  transform: translateY(-2px);
  border-color: rgba(139, 92, 246, 0.4);
}

.playlist-card-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.playlist-card-label {
  font-size: 14px;
  font-weight: 600;
}

.playlist-card-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.music-loading,
.music-error {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.artist-grid {
  display: grid;
  /* min(220px, 100%) instead of a bare 220px: minmax()'s minimum is a hard
     floor, so on a content box narrower than 220px (any viewport under
     ~350px) the single column was wider than its container. No-op at every
     width where 220px fits (measured clean at 375px and up). */
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 20px;
}

.artist-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 20px;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s ease, box-shadow 0.3s ease;
}

.artist-card:hover {
  transform: translateY(-4px);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 12px 32px rgba(139, 92, 246, 0.15);
}

.artist-card-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 12px;
}

.artist-card-name {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}

.artist-card-meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  cursor: pointer;
  /* Keeps trailing actions reachable on a narrow row by scrolling it. */
  overflow-x: auto;
}

.track-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.track-row.now-playing {
  color: var(--accent-primary);
}

.track-row:last-child {
  border-bottom: none;
}

.track-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.track-row-title {
  font-weight: 500;
}

.track-row-artist {
  color: var(--text-secondary);
  margin-left: 8px;
  font-size: 13px;
}

.track-search-actions {
  margin-left: auto;
}
</style>
