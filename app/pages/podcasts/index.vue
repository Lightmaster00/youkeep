<template>
  <div class="podcasts-page">
    <!-- GRID VIEW -->
    <div v-if="!showId">
      <div class="podcast-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Rechercher un podcast..."
          class="form-input podcast-search-input"
        />
      </div>

      <div v-if="gridPending" class="podcast-loading">Chargement...</div>

      <div v-else-if="gridError" class="podcast-error">Erreur lors du chargement des podcasts.</div>

      <EmptyState
        v-else-if="shows.length === 0"
        icon="music"
        :title="search ? 'Aucun résultat' : 'Aucun podcast archivé'"
        :description="search ? 'Aucun résultat pour cette recherche.' : 'Aucun podcast archivé pour l\'instant.'"
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
            <p class="show-card-meta">{{ s.episode_count }} épisode(s)</p>
            <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(s.visibility)">{{ formatVisibility(s.visibility) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- DETAIL VIEW -->
    <div v-else class="show-detail-view">
      <button @click="goBack" class="btn btn-secondary back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        Podcasts
      </button>

      <div v-if="detailPending" class="podcast-loading">Chargement...</div>
      <div v-else-if="detailError" class="podcast-error">Podcast introuvable ou accès refusé.</div>

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
          v-if="episodes.length === 0 && !episodesLoading"
          icon="music"
          title="Aucun épisode"
          description="Aucun épisode pour ce podcast pour l'instant."
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
            <span class="badge" :class="getStatusBadgeClass(ep.download_status)">{{ formatStatus(ep.download_status) }}</span>
            <button v-if="isAdmin" @click.stop="openEpisodeEdit(ep)" class="edit-btn" title="Modifier">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
            </button>
          </div>

          <div v-if="episodesLoading" class="podcast-loading">Chargement...</div>
          <div v-if="episodesError" class="podcast-error">
            Erreur lors du chargement des épisodes.
            <button @click="loadEpisodes" :disabled="episodesLoading" class="btn btn-secondary load-more-btn">Réessayer</button>
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

const { isAdmin } = useAuth();
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

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => fetchShows(), 300);
});

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
  return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatStatus = (status: string): string => {
  switch (status) {
    case 'completed': return 'Téléchargé';
    case 'downloading': return 'En cours';
    case 'pending': return 'En attente';
    case 'failed': return 'Échec';
    default: return status || 'En attente';
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
  min-width: 200px;
}

.podcast-loading,
.podcast-error {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.show-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
</style>
