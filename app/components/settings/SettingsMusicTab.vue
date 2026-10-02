<template>
  <div class="tab-pane">
    <div class="downloads-header-panel glass-panel" style="margin-bottom: 16px;">
      <div class="header-text">
        <h2>Clips vidéo</h2>
        <p>Télécharge aussi la vidéo (clip officiel) pour chaque nouvelle piste ingérée, en plus de l'audio. Les pistes déjà téléchargées ne sont pas affectées automatiquement — utilise le bouton « Télécharger le clip » sur une piste existante pour la rattraper manuellement.</p>
      </div>
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" v-model="musicDownloadClipsEnabled" @change="toggleMusicDownloadClips" :disabled="togglingMusicDownloadClips" />
        <span>{{ musicDownloadClipsEnabled ? 'Activé' : 'Désactivé' }}</span>
      </label>
    </div>

    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Music Ingestion</h2>
        <p>Follow YouTube channels as music artists. Audio is extracted, no re-encoding.</p>
      </div>

      <div class="queue-actions-row">
        <button
          @click="toggleMusicPause"
          class="btn"
          :class="musicIsPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
          :disabled="pausingOrResumingMusic"
        >
          <svg v-if="musicIsPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          <span>{{ musicIsPaused ? 'Resume Music Sync' : 'Pause Music Sync' }}</span>
        </button>

        <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
          <label for="max-concurrent-music-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
          <input
            id="max-concurrent-music-downloads"
            type="number"
            min="1"
            max="10"
            v-model.number="maxConcurrentMusicDownloads"
            class="form-input"
            style="width: 64px;"
          />
          <button @click="handleSaveMusicConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingMusicConcurrency">
            {{ savingMusicConcurrency ? 'Saving...' : 'Save' }}
          </button>
        </div>

        <button v-if="musicFailedCount > 0" @click="handleRetryAllMusicFailed" class="btn btn-secondary-dark" :disabled="retryingMusicFailed">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
          <span>Retry {{ musicFailedCount }} Failed</span>
        </button>
      </div>

      <form @submit.prevent="handleSaveMusicSchedule" class="policy-form-block mt-3 pt-3 border-t">
        <div class="form-group">
          <label class="checkbox-container">
            <input type="checkbox" v-model="musicScheduleForm.enabled" />
            <span class="checkmark"></span>
            Enable background artist resync automation
          </label>
        </div>

        <div v-if="musicScheduleForm.enabled" class="schedule-settings-row mt-2">
          <div class="form-group flex-1">
            <label class="form-label" for="music-preset">Preset Interval</label>
            <select id="music-preset" v-model="musicScheduleForm.preset" @change="applyMusicPreset" class="form-select">
              <option value="hourly">Hourly (Every hour)</option>
              <option value="twelve_hours">Every 12 hours</option>
              <option value="daily">Daily (resync at 3:30 AM)</option>
              <option value="weekly">Weekly (Sunday at 3:30 AM)</option>
              <option value="custom">Custom Cron Expression</option>
            </select>
          </div>

          <div class="form-group flex-1" v-if="musicScheduleForm.preset === 'custom'">
            <label class="form-label" for="music-cron">Cron Expression</label>
            <input type="text" id="music-cron" v-model="musicScheduleForm.schedule" class="form-input" placeholder="*/30 * * * *" required />
          </div>
        </div>

        <div class="form-actions mt-3">
          <button type="submit" class="btn btn-secondary-dark" :disabled="savingMusicSchedule">
            {{ savingMusicSchedule ? 'Saving...' : 'Save Sync Trigger' }}
          </button>
        </div>
      </form>
      <div v-if="musicScheduleMessage" class="settings-form-msg mt-3 settings-success-msg">
        {{ musicScheduleMessage }}
      </div>
    </div>

    <div class="downloads-dashboard-layout">
      <!-- Left Side: Add artist + followed artists -->
      <div class="downloads-main-col">
        <div class="ingest-box glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            </div>
            <div>
              <h3>Track a Music Artist</h3>
              <p class="section-desc">Paste a YouTube channel URL or @handle.</p>
            </div>
          </div>

          <form @submit.prevent="handleSearchMusicArtist" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="musicArtistSearchInput"
                placeholder="Artist or channel name (e.g. Stromae, Angèle...)"
                class="form-input settings-search-input"
                required
                :disabled="searchingMusicArtist"
              />
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </div>
            <button type="submit" class="btn btn-primary" :disabled="searchingMusicArtist">
              <span v-if="searchingMusicArtist">Searching...</span>
              <span v-else>Search Artist</span>
            </button>
          </form>

          <div v-if="musicArtistSearchResults.length > 0" class="search-results-list mt-4">
            <h4 class="results-header">Matching Channels :</h4>
            <div class="search-results-grid">
              <div v-for="ch in musicArtistSearchResults" :key="ch.id" class="search-channel-card">
                <img
                  :src="ch.avatarUrl || '/img/default-avatar.png'"
                  class="channel-avatar-thumb"
                  referrerpolicy="no-referrer"
                  @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
                />
                <div class="channel-search-info">
                  <h5>{{ ch.title }}</h5>
                  <p class="channel-search-meta">
                    <span class="subscribers">{{ ch.subscriberCount }} subs</span>
                    <span class="meta-dot">•</span>
                    <span class="videos-count">{{ ch.videoCount }} videos</span>
                  </p>
                  <p class="channel-search-desc" v-if="ch.description">{{ ch.description }}</p>
                </div>
                <button @click="selectMusicArtistCandidate(ch)" class="btn btn-primary btn-xs">
                  Suivre
                </button>
              </div>
            </div>
          </div>

          <p class="section-desc mt-3">Or paste the URL/handle directly:</p>

          <form @submit.prevent="handleAddMusicArtist" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="musicArtistInput"
                placeholder="YouTube channel URL or @handle"
                class="form-input settings-search-input"
                required
                :disabled="addingMusicArtist"
              />
            </div>
            <select v-model="musicArtistVisibility" class="form-select" :disabled="addingMusicArtist">
              <option value="">Keep current (Public if new)</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="ultra_private">Ultra Private</option>
            </select>
            <button type="submit" class="btn btn-primary" :disabled="addingMusicArtist">
              <span v-if="addingMusicArtist">Adding...</span>
              <span v-else>Add Artist</span>
            </button>
          </form>

          <div class="form-group mt-2">
            <label class="checkbox-container">
              <input type="checkbox" v-model="musicAutoSync" :disabled="addingMusicArtist" />
              <span class="checkmark"></span>
              Sync automatically (start downloading right away)
            </label>
          </div>

          <div v-if="musicIngestMessage" class="settings-form-msg mt-3" :class="musicIngestSuccess ? 'settings-success-msg' : 'settings-error-msg'">
            {{ musicIngestMessage }}
          </div>
        </div>

        <div class="ingest-box glass-panel mt-4">
          <div class="section-title-row">
            <div class="icon-orb bg-blue">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
            </div>
            <div>
              <h3>Followed Artists</h3>
              <p class="section-desc">{{ musicArtists.length }} artist(s) tracked.</p>
            </div>
          </div>

          <div v-if="musicArtists.length === 0" class="mt-3">
            <p class="section-desc">No artists followed yet.</p>
          </div>
          <div v-else class="search-results-grid mt-3">
            <div v-for="artist in musicArtists" :key="artist.id" class="search-channel-card">
              <img
                :src="artist.avatar_url || '/img/default-avatar.png'"
                class="channel-avatar-thumb"
                referrerpolicy="no-referrer"
                @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
              />
              <div class="channel-search-info">
                <h5>{{ artist.name }}</h5>
                <p class="channel-search-meta">
                  <span>{{ formatStatus(artist.sync_status) }}</span>
                  <span class="meta-dot">•</span>
                  <span>{{ artist.visibility }}</span>
                  <span class="meta-dot">•</span>
                  <span>{{ artist.track_count }} track(s)</span>
                </p>
              </div>
              <button
                @click="handleSyncMusicArtist(artist.id)"
                class="btn btn-primary btn-xs"
                :disabled="syncingArtistId === artist.id"
              >
                {{ syncingArtistId === artist.id ? 'Syncing...' : 'Sync' }}
              </button>
              <button
                v-if="artist.sync_status === 'downloading'"
                @click="handlePauseMusicArtist(artist.id)"
                class="btn btn-secondary btn-xs"
                :disabled="pausingArtistId === artist.id"
              >
                {{ pausingArtistId === artist.id ? 'Pausing...' : 'Pause' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side: Queue -->
      <div class="downloads-side-col">
        <div class="queue-box glass-panel">
          <div class="queue-header-row">
            <div class="flex-align-center gap-10">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-secondary);"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              <h3 style="margin: 0; font-size: 15px; font-weight: 700;">Music Queue</h3>
            </div>
            <span :class="musicIsPaused ? 'badge-paused-global' : 'badge-active-global'">
              {{ musicIsPaused ? 'Suspended' : 'Active' }}
            </span>
          </div>

          <div v-if="musicQueue.length === 0" class="queue-empty-state">
            <h4>Music Pipeline Idle</h4>
            <p>Queue is empty.</p>
          </div>
          <div v-else class="queue-list-premium">
            <div v-for="track in musicQueue" :key="track.id" class="queue-card-premium">
              <div class="queue-card-details">
                <div class="queue-card-meta-main">
                  <h4 class="queue-card-title" :title="track.title">{{ track.title }}</h4>
                  <span class="queue-card-channel-name">{{ track.artist_name }}</span>
                </div>
                <span class="status-badge" :class="`status-${track.download_status}`">
                  {{ formatStatus(track.download_status) }}
                </span>
              </div>

              <div class="queue-progress-container">
                <div class="progress-bar-glow-bg">
                  <div
                    class="progress-bar-glow-fill"
                    :style="{ width: (track.download_progress || 0) + '%' }"
                  ></div>
                </div>
                <span class="progress-percent-text">{{ Math.round(track.download_progress || 0) }}%</span>
              </div>

              <div class="queue-diagnostics-row" v-if="track.download_status === 'downloading'">
                <span v-if="track.download_speed" class="diag-meta-spec">Speed: {{ track.download_speed }}</span>
                <span v-if="track.download_eta" class="diag-meta-spec">ETA: {{ track.download_eta }}</span>
              </div>

              <div class="queue-error-box" v-if="track.download_status === 'failed' && track.last_error">
                <strong>Log:</strong> {{ track.last_error }}
              </div>

              <div class="queue-card-action-bar">
                <button
                  @click="handleCancelMusicTrack(track.id)"
                  class="btn-action-premium btn-action-danger"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useMusicQueue } from '~/composables/useMusicQueue';

const toast = useToast();
const { musicQueue, musicArtists, musicIsPaused, musicFailedCount, fetchMusicQueue } = useMusicQueue();

const musicDownloadClipsEnabled = ref(false);
const togglingMusicDownloadClips = ref(false);

async function fetchMusicDownloadClipsEnabled() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-clips');
    musicDownloadClipsEnabled.value = data.enabled;
  } catch (e) {
    // leave the default
  }
}

async function toggleMusicDownloadClips() {
  togglingMusicDownloadClips.value = true;
  const desired = musicDownloadClipsEnabled.value;
  try {
    await $fetch('/api/admin/settings/music-clips', { method: 'POST', body: { enabled: desired } });
    toast.success(desired ? 'Téléchargement des clips activé.' : 'Téléchargement des clips désactivé.');
  } catch (e: any) {
    musicDownloadClipsEnabled.value = !desired;
    toast.error(e?.data?.statusMessage || 'Erreur lors de la mise à jour du réglage des clips.');
  } finally {
    togglingMusicDownloadClips.value = false;
  }
}

const retryingMusicFailed = ref(false);
const pausingOrResumingMusic = ref(false);
const maxConcurrentMusicDownloads = ref(2);
const savingMusicConcurrency = ref(false);
const musicArtistInput = ref('');
const musicArtistVisibility = ref('');
const musicAutoSync = ref(true);
const addingMusicArtist = ref(false);
const musicIngestMessage = ref('');
const musicIngestSuccess = ref(false);
const syncingArtistId = ref<string | null>(null);
const pausingArtistId = ref<string | null>(null);

const musicArtistSearchInput = ref('');
const searchingMusicArtist = ref(false);
const musicArtistSearchResults = ref<any[]>([]);

const handleSearchMusicArtist = async () => {
  const q = musicArtistSearchInput.value.trim();
  if (!q) return;

  searchingMusicArtist.value = true;
  musicArtistSearchResults.value = [];
  try {
    const data = await $fetch<any>('/api/admin/downloader/search-channels', {
      params: { q }
    });
    musicArtistSearchResults.value = data.channels || [];
    if (musicArtistSearchResults.value.length === 0) {
      toast.info('No channels found for this search.');
    }
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Search failed.');
  } finally {
    searchingMusicArtist.value = false;
  }
};

const selectMusicArtistCandidate = (channel: any) => {
  musicArtistInput.value = channel.handle
    ? `https://www.youtube.com${channel.handle}`
    : channel.id ? `https://www.youtube.com/channel/${channel.id}` : '';
  musicArtistSearchResults.value = [];
};

const toggleMusicPause = async () => {
  pausingOrResumingMusic.value = true;
  try {
    const endpoint = musicIsPaused.value ? '/api/admin/music/resume' : '/api/admin/music/pause';
    await $fetch(endpoint, { method: 'POST' });
    musicIsPaused.value = !musicIsPaused.value;
    toast.success(musicIsPaused.value ? 'Music downloads paused.' : 'Music downloads resumed.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'An error occurred.');
  } finally {
    pausingOrResumingMusic.value = false;
  }
};

const fetchMusicConcurrency = async () => {
  try {
    const data = await $fetch<any>('/api/admin/music/concurrency');
    maxConcurrentMusicDownloads.value = data.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error('Failed to fetch music concurrency setting:', err);
  }
};

const handleSaveMusicConcurrency = async () => {
  savingMusicConcurrency.value = true;
  try {
    await $fetch('/api/admin/music/concurrency', {
      method: 'POST',
      body: { maxConcurrentDownloads: maxConcurrentMusicDownloads.value }
    });
    toast.success('Music concurrency setting saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save music concurrency setting.');
  } finally {
    savingMusicConcurrency.value = false;
  }
};

const savingMusicSchedule = ref(false);
const musicScheduleMessage = ref('');

const musicScheduleForm = reactive({
  enabled: false,
  preset: 'daily',
  schedule: '30 3 * * *'
});

const musicPresets: Record<string, string> = {
  hourly: '0 * * * *',
  twelve_hours: '0 */12 * * *',
  daily: '30 3 * * *',
  weekly: '30 3 * * 0'
};

const applyMusicPreset = () => {
  if (musicScheduleForm.preset !== 'custom') {
    musicScheduleForm.schedule = musicPresets[musicScheduleForm.preset] || '30 3 * * *';
  }
};

const fetchMusicSchedule = async () => {
  try {
    const data = await $fetch<any>('/api/admin/music/schedule');
    musicScheduleForm.enabled = data.enabled;
    musicScheduleForm.schedule = data.schedule || '30 3 * * *';

    const foundPreset = Object.keys(musicPresets).find(k => musicPresets[k] === musicScheduleForm.schedule);
    musicScheduleForm.preset = foundPreset || 'custom';
  } catch (err) {
    console.error('Failed to fetch music schedule:', err);
  }
};

const handleSaveMusicSchedule = async () => {
  savingMusicSchedule.value = true;
  musicScheduleMessage.value = '';
  try {
    await $fetch('/api/admin/music/schedule', {
      method: 'POST',
      body: {
        enabled: musicScheduleForm.enabled,
        schedule: musicScheduleForm.schedule
      }
    });
    musicScheduleMessage.value = 'Music synchronization frequency saved successfully.';
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingMusicSchedule.value = false;
  }
};

const handleAddMusicArtist = async () => {
  const url = musicArtistInput.value.trim();
  if (!url) return;

  addingMusicArtist.value = true;
  musicIngestMessage.value = '';
  try {
    const res = await $fetch<any>('/api/admin/music/ingest', {
      method: 'POST',
      body: {
        url,
        sync_status: musicAutoSync.value ? 'downloading' : 'paused',
        ...(musicArtistVisibility.value ? { visibility: musicArtistVisibility.value } : {})
      }
    });
    musicIngestSuccess.value = res.success;
    musicIngestMessage.value = res.message;
    musicArtistInput.value = '';
    toast.success('Artist added.');
    fetchMusicQueue();
  } catch (err: any) {
    musicIngestSuccess.value = false;
    musicIngestMessage.value = err.data?.statusMessage || 'Failed to add artist.';
    toast.error('Error adding artist.');
  } finally {
    addingMusicArtist.value = false;
  }
};

const handleSyncMusicArtist = async (artistId: string) => {
  syncingArtistId.value = artistId;
  try {
    await $fetch(`/api/admin/music/artists/${artistId}/sync`, { method: 'POST' });
    toast.success('Artist sync started.');
    setTimeout(() => fetchMusicQueue(), 3000);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to sync artist.');
  } finally {
    syncingArtistId.value = null;
  }
};

const handlePauseMusicArtist = async (artistId: string) => {
  pausingArtistId.value = artistId;
  try {
    await $fetch(`/api/admin/music/artists/${artistId}/pause`, { method: 'POST' });
    toast.success('Artist sync paused.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to pause artist.');
  } finally {
    pausingArtistId.value = null;
  }
};

const handleCancelMusicTrack = async (trackId: string) => {
  try {
    await $fetch(`/api/admin/music/tracks/${trackId}/cancel`, { method: 'POST' });
    toast.success('Download cancelled.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Cancellation failed.');
  }
};

const handleRetryAllMusicFailed = async () => {
  retryingMusicFailed.value = true;
  try {
    await $fetch('/api/admin/music/retry-failed', { method: 'POST' });
    fetchMusicQueue();
    toast.success('Failed downloads retried.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  } finally {
    retryingMusicFailed.value = false;
  }
};

const formatStatus = (status: string) => {
  const s: Record<string, string> = {
    pending: 'Pending',
    downloading: 'Downloading',
    failed: 'Failed',
    completed: 'Completed'
  };
  return s[status] || status;
};

onMounted(() => {
  fetchMusicConcurrency();
  fetchMusicDownloadClipsEnabled();
  fetchMusicSchedule();
});
</script>
