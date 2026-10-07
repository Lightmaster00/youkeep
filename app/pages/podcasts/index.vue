<template>
  <div class="podcasts-page">
    <!-- GRID VIEW -->
    <div v-if="!showId">
      <div class="podcast-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Search for a podcast or an episode..."
          class="form-input podcast-search-input"
        />
      </div>

      <template v-if="search">
        <div v-if="episodeSearchPending" class="podcast-loading">Loading...</div>
        <div v-else-if="episodeSearchError" class="podcast-error">Search failed.</div>
        <EmptyState
          v-else-if="episodeSearchResults.length === 0"
          icon="music"
          title="No results"
          description="No episodes match this search."
        />
        <div v-else class="episode-search-results">
          <div
            v-for="episode in episodeSearchResults"
            :key="episode.id"
            class="episode-search-row"
            @click="playEpisodeSearchResult(episode)"
          >
            <span class="episode-search-title" v-html="highlightMatch(episode.title, search)"></span>
            <span class="episode-search-show">{{ episode.show_title }}</span>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="gridPending" class="podcast-loading">Loading...</div>

        <div v-else-if="gridError" class="podcast-error">Failed to load podcasts.</div>

        <EmptyState
          v-else-if="shows.length === 0"
          icon="music"
          title="No podcasts archived"
          description="No podcasts archived yet."
        />

        <div v-else class="show-grid">
          <div
            v-for="s in shows"
            :key="s.id"
            class="show-card"
            @click="router.push({ path: '/podcasts', query: { showId: s.id } })"
          >
            <img :src="s.cover_url || fallbackCover" @error="handleCoverError" class="show-card-cover" alt="" />
            <div class="show-card-body">
              <h3 class="show-card-title">{{ s.title }}</h3>
              <p class="show-card-meta">{{ s.episode_count }} episode(s)</p>
              <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(s.visibility)">{{ formatVisibility(s.visibility) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- DETAIL VIEW -->
    <div v-else class="show-detail-view">
      <button @click="goBack" class="btn btn-secondary back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        Podcasts
      </button>

      <div v-if="detailPending" class="podcast-loading">Loading...</div>
      <div v-else-if="detailError" class="podcast-error">Podcast not found or access denied.</div>

      <template v-else-if="show">
        <div class="show-detail-header">
          <img :src="show.cover_url || fallbackCover" @error="handleCoverError" class="show-detail-cover" alt="" />
          <div class="show-detail-info">
            <div class="title-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <h1 class="show-detail-title">{{ show.title }}</h1>
              <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(show.visibility)">{{ formatVisibility(show.visibility) }}</span>
            </div>
            <p v-if="show.author" class="show-detail-author">{{ show.author }}</p>
            <p v-if="show.description" class="show-detail-desc">{{ show.description }}</p>
          </div>
        </div>

        <EmptyState
          v-if="episodes.length === 0 && !episodesLoading && !episodesError"
          icon="music"
          title="No episodes"
          description="No episodes for this podcast yet."
        />

        <div v-else class="episode-list">
          <div v-for="ep in episodes" :key="ep.id" class="episode-row">
            <div class="episode-main">
              <h4 class="episode-title">{{ ep.title }}</h4>
              <p class="episode-meta">
                <span v-if="ep.season_number">S{{ ep.season_number }}</span>
                <span v-if="ep.episode_number">E{{ ep.episode_number }}</span>
                <span v-if="ep.pub_date">{{ formatPubDate(ep.pub_date) }}</span>
                <span>{{ formatDuration(ep.duration) }}</span>
              </p>
            </div>
            <button
              v-if="ep.download_status === 'completed' && ep.local_file_path"
              @click.stop="playEpisode(ep)"
              class="episode-play-btn"
              title="Play episode"
              aria-label="Play episode"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
            <span class="badge" :class="getStatusBadgeClass(ep.download_status)">{{ formatStatus(ep.download_status) }}</span>
            <button v-if="isAdmin" @click.stop="openEpisodeEdit(ep)" class="edit-btn" title="Edit">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
            </button>
          </div>

          <div v-if="episodesLoading" class="podcast-loading">Loading...</div>
          <div v-if="episodesError" class="podcast-error">
            Failed to load episodes.
            <button @click="loadEpisodes" :disabled="episodesLoading" class="btn btn-secondary load-more-btn">Retry</button>
          </div>
          <button
            v-if="episodes.length < episodesTotal"
            @click="loadEpisodes"
            :disabled="episodesLoading"
            class="btn btn-secondary load-more-btn"
          >
            Charger plus
          </button>
        </div>
      </template>
    </div>

    <PodcastEpisodeEditModal
      :show="!!editingEpisode"
      :episode="editingEpisode"
      @close="closeEpisodeEdit"
      @saved="handleEpisodeSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { highlightMatch } from '../../utils/highlightMatch';

const { isAdmin } = useAuth();
const { play: playPodcastEpisode } = usePodcastPlayer();
const route = useRoute();
const router = useRouter();

const showId = computed(() => (route.query.showId ? String(route.query.showId) : ''));

// --- Grid view state ---
const search = ref('');
const shows = ref<any[]>([]);
const gridPending = ref(true);
const gridError = ref(false);

let showsRequestId = 0;

async function fetchShows() {
  const requestId = ++showsRequestId;
  gridPending.value = true;
  gridError.value = false;
  try {
    const params: Record<string, string> = {};
    if (search.value) params.search = search.value;
    const data = await $fetch<any>('/api/podcasts/shows', { params });
    if (requestId !== showsRequestId) return;
    shows.value = data.shows || [];
  } catch (e) {
    if (requestId !== showsRequestId) return;
    shows.value = [];
    gridError.value = true;
  } finally {
    if (requestId !== showsRequestId) return;
    gridPending.value = false;
  }
}

const episodeSearchResults = ref<any[]>([]);
const episodeSearchPending = ref(false);
const episodeSearchError = ref(false);
let episodeSearchRequestId = 0;

async function fetchEpisodeSearch() {
  const requestId = ++episodeSearchRequestId;
  episodeSearchPending.value = true;
  episodeSearchError.value = false;
  try {
    const data = await $fetch<any>('/api/podcasts/episodes/search', { params: { q: search.value } });
    if (requestId !== episodeSearchRequestId) return;
    episodeSearchResults.value = data.episodes || [];
  } catch (e) {
    if (requestId !== episodeSearchRequestId) return;
    episodeSearchResults.value = [];
    episodeSearchError.value = true;
  } finally {
    if (requestId !== episodeSearchRequestId) return;
    episodeSearchPending.value = false;
  }
}

// The episodes-search endpoint carries the show's cover art, so it's passed
// through directly to the mini-player — matches how playEpisode() below
// (the detail view's own click handler) sources show_cover_url from the
// already-loaded show, just from the search result row instead.
function playEpisodeSearchResult(ep: any) {
  if (!ep.local_file_path) return;
  playPodcastEpisode({
    id: ep.id,
    title: ep.title,
    show_title: ep.show_title,
    show_cover_url: ep.show_cover_url ?? null,
    duration: ep.duration ?? null,
    local_file_path: ep.local_file_path,
  });
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    if (search.value) {
      fetchEpisodeSearch();
    } else {
      fetchShows();
    }
  }, 300);
});

// Keep `search` in sync with ?q= so the header search bar's navigation to
// /podcasts?q=<term> (both in per_space mode, and via /search's "Voir plus
// de podcasts" link) actually triggers a search — Vue Router does not
// remount this component for a query-only navigation to the same route, so
// this must be a watcher, not just an onMounted read.
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

// --- Detail view state ---
const show = ref<any>(null);
const episodes = ref<any[]>([]);
const episodesTotal = ref(0);
const episodesLoading = ref(false);
const episodesError = ref(false);
const detailPending = ref(false);
const detailError = ref(false);

let detailRequestId = 0;

async function fetchShowDetail() {
  const requestId = ++detailRequestId;
  detailPending.value = true;
  detailError.value = false;
  show.value = null;
  episodes.value = [];
  episodesTotal.value = 0;
  episodesError.value = false;
  try {
    const data = await $fetch<any>(`/api/podcasts/shows/${showId.value}`);
    if (requestId !== detailRequestId) return;
    show.value = data.show;
  } catch (e) {
    if (requestId !== detailRequestId) return;
    detailError.value = true;
    detailPending.value = false;
    return;
  }
  detailPending.value = false;
  await loadEpisodes();
}

async function loadEpisodes() {
  if (!showId.value) return;
  const requestId = detailRequestId;
  episodesLoading.value = true;
  episodesError.value = false;
  try {
    const data = await $fetch<any>(`/api/podcasts/shows/${showId.value}/episodes`, {
      params: { limit: 50, offset: episodes.value.length }
    });
    if (requestId !== detailRequestId) return;
    episodes.value.push(...(data.episodes || []));
    episodesTotal.value = data.total || 0;
  } catch (e) {
    if (requestId !== detailRequestId) return;
    episodesError.value = true;
  } finally {
    if (requestId !== detailRequestId) return;
    episodesLoading.value = false;
  }
}

function goBack() {
  router.push('/podcasts');
}

// --- Episode editing ---
const editingEpisode = ref<any | null>(null);

function openEpisodeEdit(episode: any) {
  editingEpisode.value = episode;
}

function closeEpisodeEdit() {
  editingEpisode.value = null;
}

function handleEpisodeSaved(updated: any) {
  const existing = episodes.value.find((e: any) => e.id === updated.id);
  if (existing) Object.assign(existing, updated);
  closeEpisodeEdit();
}

// The episodes endpoint carries no cover art, so the show-level cover and
// title are passed through for the mini-player to display.
function playEpisode(ep: any) {
  if (!ep.local_file_path) return;
  playPodcastEpisode({
    id: ep.id,
    title: ep.title,
    show_title: show.value?.title,
    show_cover_url: show.value?.cover_url ?? null,
    duration: ep.duration ?? null,
    local_file_path: ep.local_file_path,
  });
}

watch(showId, (newId, oldId) => {
  if (newId && newId !== oldId) {
    fetchShowDetail();
  } else if (!newId && oldId) {
    fetchShows();
  }
});

onMounted(() => {
  if (showId.value) {
    fetchShowDetail();
  } else {
    fetchShows();
  }
});

// --- Shared formatters (duplicated per-page, matching this codebase's
// existing convention — see music/index.vue, channels.vue, watch/[id].vue,
// none of which share a formatting util module) ---
const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z\'></path><path d=\'M19 10v2a7 7 0 0 1-14 0v-2\'></path><line x1=\'12\' y1=\'19\' x2=\'12\' y2=\'23\'></line><line x1=\'8\' y1=\'23\' x2=\'16\' y2=\'23\'></line></svg>';

const handleCoverError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) {
    target.src = fallbackCover;
  }
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// pub_date is the raw RSS date string (TEXT), so it may be unparseable —
// fall back to showing it verbatim rather than "Invalid Date".
const formatPubDate = (raw: string | null): string => {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatStatus = (status: string): string => {
  switch (status) {
    case 'completed': return 'Downloaded';
    case 'downloading': return 'In progress';
    case 'pending': return 'Queued';
    case 'failed': return 'Failed';
    default: return status || 'Queued';
  }
};

const getStatusBadgeClass = (status: string): string => {
  switch (status) {
    case 'completed': return 'badge-completed';
    case 'downloading': return 'badge-downloading';
    case 'failed': return 'badge-failed';
    default: return 'badge-pending';
  }
};

const formatVisibility = (vis: string): string => {
  switch (vis) {
    case 'public': return 'Public';
    case 'private': return 'Private';
    case 'ultra_private': return 'Ultra Private';
    default: return vis || 'Public';
  }
};

const getVisBadgeClass = (vis: string): string => {
  switch (vis) {
    case 'public': return 'badge-completed';
    case 'private': return 'badge-downloading';
    case 'ultra_private': return 'badge-failed';
    default: return 'badge-completed';
  }
};
</script>

<style scoped>
.podcast-filters-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.podcast-search-input {
  flex: 1;
  /* Same fix as music/index.vue's .music-search-input: the 200px floor
     exceeded the filters bar's content box at a 320px viewport even though
     the input already sits alone on its wrapped line. */
  min-width: 0;
}

.podcast-loading,
.podcast-error {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.show-grid {
  display: grid;
  /* Same fix as music/index.vue's .artist-grid: minmax()'s 220px minimum is
     a hard floor, overflowing any content box under ~350px. No-op at every
     width where 220px fits. */
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 20px;
}

.show-card {
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

.show-card:hover {
  transform: translateY(-4px);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 12px 32px rgba(139, 92, 246, 0.15);
}

.show-card-cover {
  width: 120px;
  height: 120px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  margin-bottom: 12px;
}

.show-card-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}

.show-card-meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.back-btn {
  margin-bottom: 20px;
}

.show-detail-header {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 32px;
}

/* Same fix as music/index.vue's .artist-detail-header, mirroring
   channels.vue's existing .channel-profile-header stacking. Below 480px
   the 140px cover + 20px gap leave too little width for the info column
   (title, author, description) to hold real content without overflowing. */
@media (max-width: 480px) {
  .show-detail-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}

.show-detail-cover {
  width: 140px;
  height: 140px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
}

.show-detail-title {
  font-size: 24px;
  font-weight: 700;
}

.show-detail-author {
  color: var(--text-secondary);
  font-size: 14px;
  margin-top: 2px;
}

.show-detail-desc {
  color: var(--text-secondary);
  margin-top: 8px;
  max-width: 720px;
  line-height: 1.5;
}

.episode-list {
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-lg);
  padding: 8px 16px 16px;
}

.episode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  /* .episode-main already has min-width: 0 (line 467-470), but the play
     button, the status badge, and (for an admin) the edit button are all
     effectively fixed-size and their combined width can still exceed the
     row's content box at a 320px viewport. overflow-x: auto makes any
     excess reachable by scrolling the row instead of leaving it clipped
     by an ancestor's overflow: hidden. */
  overflow-x: auto;
}

.episode-row:last-child {
  border-bottom: none;
}

.episode-main {
  flex: 1;
  min-width: 0;
}

.episode-title {
  font-size: 14px;
  font-weight: 600;
}

.episode-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.episode-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.episode-search-row {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.episode-search-row:hover {
  background: var(--surface-hover);
}

.episode-search-title {
  font-weight: 500;
}

.episode-search-show {
  color: var(--text-secondary);
  margin-left: 8px;
  font-size: 13px;
}

.load-more-btn {
  margin-top: 12px;
}

.edit-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  display: inline-flex;
  align-items: center;
  transition: color 0.2s;
  flex-shrink: 0;
}

.edit-btn:hover {
  color: var(--text-primary);
}

.episode-play-btn {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 26px;
  height: 26px;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: color 0.2s, border-color 0.2s;
  flex-shrink: 0;
}

.episode-play-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-primary);
}
</style>
