<template>
  <div class="music-page">
    <!-- GRID VIEW -->
    <div v-if="!artistId">
      <div class="music-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Rechercher un artiste..."
          class="form-input music-search-input"
        />
        <select v-model="genre" class="form-input">
          <option value="">Tous les genres</option>
          <option v-for="g in facets.genres" :key="g" :value="g">{{ g }}</option>
        </select>
        <select v-model="language" class="form-input">
          <option value="">Toutes les langues</option>
          <option v-for="l in facets.languages" :key="l" :value="l">{{ l }}</option>
        </select>
        <select v-model="year" class="form-input">
          <option value="">Toutes les années</option>
          <option v-for="y in facets.years" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>

      <div v-if="gridPending" class="music-loading">Chargement...</div>

      <div v-else-if="gridError" class="music-error">Erreur lors du chargement des artistes.</div>

      <EmptyState
        v-else-if="artists.length === 0"
        icon="music"
        :title="hasActiveFilters ? 'Aucun résultat' : 'Aucun artiste archivé'"
        :description="hasActiveFilters ? 'Aucun résultat pour ces filtres.' : 'Aucun artiste archivé pour l\'instant.'"
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
            <p class="artist-card-meta">{{ a.track_count }} titre(s)</p>
            <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(a.visibility)">{{ formatVisibility(a.visibility) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- DETAIL VIEW -->
    <div v-else class="artist-detail-view">
      <button @click="goBack" class="btn btn-secondary back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        Musique
      </button>

      <div v-if="detailPending" class="music-loading">Chargement...</div>
      <div v-else-if="detailError" class="music-error">Artiste introuvable ou accès refusé.</div>

      <template v-else-if="artist">
        <div class="artist-detail-header">
          <img :src="artist.avatar_url || fallbackAvatar" @error="handleAvatarError" class="artist-detail-avatar" alt="" />
          <div class="artist-detail-info">
            <div class="title-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <h1 class="artist-detail-name">{{ artist.name }}</h1>
              <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(artist.visibility)">{{ formatVisibility(artist.visibility) }}</span>
            </div>
            <p v-if="artist.description" class="artist-detail-desc">{{ artist.description }}</p>
          </div>
        </div>

        <EmptyState
          v-if="albums.length === 0 && standaloneTrackCount === 0"
          icon="music"
          title="Aucun titre archivé"
          description="Aucun titre complété pour cet artiste pour l'instant."
        />

        <div v-for="album in albums" :key="album.id" class="album-group">
          <div class="album-header" @click="toggleAlbumExpand(album.id)">
            <img :src="album.cover_url || fallbackCover" class="album-cover" alt="" />
            <div class="album-info">
              <h3 class="album-title">{{ album.title }}</h3>
              <p class="album-meta">{{ album.release_year || 'Année inconnue' }} &bull; {{ album.track_count }} titre(s)</p>
            </div>
            <button v-if="isAdmin" @click.stop="openAlbumEdit(album)" class="edit-btn" title="Modifier">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
            </button>
          </div>
          <div v-if="expandedAlbums[album.id]" class="album-tracks">
            <div
              v-for="track in trackGroups[album.id]?.tracks || []"
              :key="track.id"
              class="track-row"
              :class="{ 'now-playing': currentTrack?.id === track.id }"
              @click="playTrack(track, album.id)"
            >
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click.stop="openTrackEdit(track, album.id)" class="edit-btn" title="Modifier">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
              </button>
            </div>
            <div v-if="trackGroups[album.id]?.loading" class="music-loading">Chargement...</div>
            <div v-if="trackGroups[album.id]?.error" class="music-error">
              Erreur lors du chargement des titres.
              <button @click="loadTracks(album.id)" class="btn btn-secondary load-more-btn">Réessayer</button>
            </div>
            <button
              v-if="(trackGroups[album.id]?.tracks.length || 0) < (trackGroups[album.id]?.total || 0)"
              @click="loadTracks(album.id)"
              :disabled="trackGroups[album.id]?.loading"
              class="btn btn-secondary load-more-btn"
            >
              Charger plus
            </button>
          </div>
        </div>

        <div v-if="standaloneTrackCount > 0" class="album-group">
          <div class="album-header" @click="toggleStandalone">
            <div class="album-cover album-cover-placeholder"></div>
            <div class="album-info">
              <h3 class="album-title">Titres sans album</h3>
              <p class="album-meta">{{ standaloneTrackCount }} titre(s)</p>
            </div>
          </div>
          <div v-if="standaloneExpanded" class="album-tracks">
            <div
              v-for="track in trackGroups['none']?.tracks || []"
              :key="track.id"
              class="track-row"
              :class="{ 'now-playing': currentTrack?.id === track.id }"
              @click="playTrack(track, 'none')"
            >
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click.stop="openTrackEdit(track, 'none')" class="edit-btn" title="Modifier">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
              </button>
            </div>
            <div v-if="trackGroups['none']?.loading" class="music-loading">Chargement...</div>
            <div v-if="trackGroups['none']?.error" class="music-error">
              Erreur lors du chargement des titres.
              <button @click="loadTracks('none')" class="btn btn-secondary load-more-btn">Réessayer</button>
            </div>
            <button
              v-if="(trackGroups['none']?.tracks.length || 0) < (trackGroups['none']?.total || 0)"
              @click="loadTracks('none')"
              :disabled="trackGroups['none']?.loading"
              class="btn btn-secondary load-more-btn"
            >
              Charger plus
            </button>
          </div>
        </div>
      </template>
    </div>

    <MusicTrackEditModal
      :show="!!editingTrack"
      :track="editingTrack?.track ?? null"
      @close="closeTrackEdit"
      @saved="handleTrackSaved"
    />
    <MusicAlbumEditModal
      :show="!!editingAlbum"
      :album="editingAlbum"
      @close="closeAlbumEdit"
      @saved="handleAlbumSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { useMusicPlayer } from '~/composables/useMusicPlayer';

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
  } catch (e) {
    if (requestId !== artistsRequestId) return;
    artists.value = [];
    gridError.value = true;
  } finally {
    if (requestId !== artistsRequestId) return;
    gridPending.value = false;
  }
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => fetchArtists(), 300);
});
watch([genre, language, year], () => fetchArtists());

// --- Detail view state ---
const artist = ref<any>(null);
const albums = ref<any[]>([]);
const standaloneTrackCount = ref(0);
const detailPending = ref(false);
const detailError = ref(false);

const expandedAlbums = reactive<Record<string, boolean>>({});
const standaloneExpanded = ref(false);
const trackGroups = reactive<Record<string, { tracks: any[]; total: number; loaded: boolean; loading: boolean; error: boolean }>>({});

function ensureGroup(key: string) {
  if (!trackGroups[key]) {
    trackGroups[key] = { tracks: [], total: 0, loaded: false, loading: false, error: false };
  }
  return trackGroups[key];
}

async function loadTracks(albumIdKey: string) {
  const group = ensureGroup(albumIdKey);
  group.loading = true;
  group.error = false;
  try {
    const data = await $fetch<any>(`/api/music/artists/${artistId.value}/tracks`, {
      params: { albumId: albumIdKey, limit: 50, offset: group.tracks.length }
    });
    group.tracks.push(...(data.tracks || []));
    group.total = data.total || 0;
    group.loaded = true;
    group.error = false;
  } catch (e) {
    group.error = true;
  } finally {
    group.loading = false;
  }
}

function toggleAlbumExpand(albumId: string) {
  expandedAlbums[albumId] = !expandedAlbums[albumId];
  if (expandedAlbums[albumId]) {
    const group = ensureGroup(albumId);
    if (!group.loaded && !group.loading) loadTracks(albumId);
  }
}

function toggleStandalone() {
  standaloneExpanded.value = !standaloneExpanded.value;
  if (standaloneExpanded.value) {
    const group = ensureGroup('none');
    if (!group.loaded && !group.loading) loadTracks('none');
  }
}

function playTrack(track: any, groupKey: string) {
  if (!track.local_file_path) return;
  const group = trackGroups[groupKey];
  if (!group) return;
  playMusicTrack(track, group.tracks);
}

const editingTrack = ref<{ track: any; groupKey: string } | null>(null);
const editingAlbum = ref<any | null>(null);

function openTrackEdit(track: any, groupKey: string) {
  editingTrack.value = { track, groupKey };
}

function closeTrackEdit() {
  editingTrack.value = null;
}

function handleTrackSaved(updated: any) {
  if (!editingTrack.value) return;
  const group = trackGroups[editingTrack.value.groupKey];
  if (group) {
    const existing = group.tracks.find((t: any) => t.id === updated.id);
    if (existing) Object.assign(existing, updated);
  }
  closeTrackEdit();
}

function openAlbumEdit(album: any) {
  editingAlbum.value = album;
}

function closeAlbumEdit() {
  editingAlbum.value = null;
}

function handleAlbumSaved(updated: any) {
  const existing = albums.value.find((a: any) => a.id === updated.id);
  if (existing) Object.assign(existing, updated);
  closeAlbumEdit();
}

let detailRequestId = 0;

async function fetchArtistDetail() {
  const requestId = ++detailRequestId;
  detailPending.value = true;
  detailError.value = false;
  artist.value = null;
  albums.value = [];
  standaloneTrackCount.value = 0;
  Object.keys(expandedAlbums).forEach((k) => delete expandedAlbums[k]);
  Object.keys(trackGroups).forEach((k) => delete trackGroups[k]);
  standaloneExpanded.value = false;
  try {
    const data = await $fetch<any>(`/api/music/artists/${artistId.value}`);
    if (requestId !== detailRequestId) return;
    artist.value = data.artist;
    albums.value = data.albums || [];
    standaloneTrackCount.value = data.standaloneTrackCount || 0;
  } catch (e) {
    if (requestId !== detailRequestId) return;
    detailError.value = true;
  } finally {
    if (requestId !== detailRequestId) return;
    detailPending.value = false;
  }
}

function goBack() {
  router.push('/music');
}

watch(artistId, (newId, oldId) => {
  if (newId && newId !== oldId) {
    fetchArtistDetail();
  } else if (!newId && oldId) {
    fetchArtists();
  }
});

onMounted(() => {
  if (artistId.value) {
    fetchArtistDetail();
  } else {
    fetchArtists();
  }
});

// --- Shared formatters (duplicated per-page, matching this codebase's
// existing convention — see channels.vue / watch/[id].vue / index.vue,
// none of which share a formatting util module) ---
const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>';
const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M9 18V5l12-2v13\'></path><circle cx=\'6\' cy=\'18\' r=\'3\'></circle><circle cx=\'18\' cy=\'16\' r=\'3\'></circle></svg>';

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackAvatar) {
    target.src = fallbackAvatar;
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
.music-filters-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.music-search-input {
  flex: 1;
  min-width: 200px;
}

.music-filters-bar select.form-input {
  width: auto;
  flex: 0 1 auto;
  min-width: 150px;
}

.music-loading,
.music-error {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.artist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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

.back-btn {
  margin-bottom: 20px;
}

.artist-detail-header {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 32px;
}

.artist-detail-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.artist-detail-name {
  font-size: 24px;
  font-weight: 700;
}

.artist-detail-desc {
  color: var(--text-secondary);
  margin-top: 4px;
}

.album-group {
  margin-bottom: 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-lg);
  overflow: hidden;
}

.album-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  cursor: pointer;
  background: rgba(17, 17, 34, 0.4);
}

.album-header:hover {
  background: rgba(17, 17, 34, 0.6);
}

.album-cover {
  width: 56px;
  height: 56px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
}

.album-cover-placeholder {
  background: rgba(255, 255, 255, 0.05);
}

.album-title {
  font-size: 16px;
  font-weight: 600;
}

.album-meta {
  font-size: 13px;
  color: var(--text-secondary);
}

.album-tracks {
  padding: 8px 16px 16px;
}

.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  cursor: pointer;
}

.track-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.track-row.now-playing {
  color: var(--accent-primary);
}

.track-row.now-playing .track-number,
.track-row.now-playing .track-duration {
  color: var(--accent-primary);
}

.track-row:last-child {
  border-bottom: none;
}

.track-number {
  width: 24px;
  text-align: right;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.track-title {
  flex: 1;
}

.track-duration {
  color: var(--text-secondary);
  flex-shrink: 0;
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
  margin-left: auto;
}

.edit-btn:hover {
  color: var(--text-primary);
}
</style>
