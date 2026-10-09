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
        <PodcastContinueRow />

        <div v-if="gridPending" class="podcast-loading">Loading...</div>

        <div v-else-if="gridError" class="podcast-error">Failed to load podcasts.</div>

        <EmptyState
          v-else-if="shows.length === 0"
          icon="music"
          title="No podcasts archived"
          description="No podcasts archived yet."
        />

        <div v-else class="show-grid">
          <PodcastShowCard v-for="s in shows" :key="s.id" :show="s" :show-visibility="isAdmin" />
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
              <ShowFollowButton :show-id="show.id" :show-title="show.title" />
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
          <PodcastEpisodeRow
            v-for="ep in episodes"
            :key="ep.id"
            :episode="ep"
            :can-edit="isAdmin"
            @play="playEpisode"
            @edit="openEpisodeEdit"
          />

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
            Load more
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

.back-btn {
  margin-bottom: 20px;
}

.show-detail-header {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 32px;
}

/* Mirrors channels.vue's existing .channel-profile-header stacking. Below 480px
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

</style>
