<template>
  <div class="tab-pane">
    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Podcast Ingestion</h2>
        <p>Follow podcast RSS feeds. Episode audio is downloaded straight from each item's enclosure — no re-encoding.</p>
      </div>

      <div class="queue-actions-row">
        <button
          @click="togglePodcastPause"
          class="btn"
          :class="podcastIsPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
          :disabled="pausingOrResumingPodcast"
        >
          <svg v-if="podcastIsPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          <span>{{ podcastIsPaused ? 'Resume Podcast Sync' : 'Pause Podcast Sync' }}</span>
        </button>

        <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
          <label for="max-concurrent-podcast-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
          <input
            id="max-concurrent-podcast-downloads"
            type="number"
            min="1"
            v-model.number="maxConcurrentPodcastDownloads"
            class="form-input"
            style="width: 64px;"
          />
          <button @click="handleSavePodcastConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingPodcastConcurrency">
            {{ savingPodcastConcurrency ? 'Saving...' : 'Save' }}
          </button>
        </div>

        <button v-if="podcastFailedCount > 0" @click="handleRetryAllPodcastFailed" class="btn btn-secondary-dark" :disabled="retryingPodcastFailed">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
          <span>Retry {{ podcastFailedCount }} Failed</span>
        </button>
      </div>

      <form @submit.prevent="handleSavePodcastSchedule" class="policy-form-block mt-3 pt-3 border-t">
        <div class="form-group">
          <label class="checkbox-container">
            <input type="checkbox" v-model="podcastScheduleForm.enabled" />
            <span class="checkmark"></span>
            Enable background feed resync automation
          </label>
        </div>

        <div v-if="podcastScheduleForm.enabled" class="schedule-settings-row mt-2">
          <div class="form-group flex-1">
            <label class="form-label" for="podcast-preset">Preset Interval</label>
            <select id="podcast-preset" v-model="podcastScheduleForm.preset" @change="applyPodcastPreset" class="form-select">
              <option value="hourly">Hourly (Every hour)</option>
              <option value="twelve_hours">Every 12 hours</option>
              <option value="daily">Daily (resync at 4:00 AM)</option>
              <option value="weekly">Weekly (Sunday at 4:00 AM)</option>
              <option value="custom">Custom Cron Expression</option>
            </select>
          </div>

          <div class="form-group flex-1" v-if="podcastScheduleForm.preset === 'custom'">
            <label class="form-label" for="podcast-cron">Cron Expression</label>
            <input type="text" id="podcast-cron" v-model="podcastScheduleForm.schedule" class="form-input" placeholder="*/30 * * * *" required />
          </div>
        </div>

        <div class="form-actions mt-3">
          <button type="submit" class="btn btn-secondary-dark" :disabled="savingPodcastSchedule">
            {{ savingPodcastSchedule ? 'Saving...' : 'Save Sync Trigger' }}
          </button>
        </div>
      </form>
      <div v-if="podcastScheduleMessage" class="settings-form-msg mt-3 settings-success-msg">
        {{ podcastScheduleMessage }}
      </div>
    </div>

    <div class="downloads-dashboard-layout">
      <!-- Left Side: Add feed + followed shows -->
      <div class="downloads-main-col">
        <div class="ingest-box glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </div>
            <div>
              <h3>Track a Podcast</h3>
              <p class="section-desc">Paste an RSS feed URL.</p>
            </div>
          </div>

          <form @submit.prevent="handleAddPodcastShow" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="podcastFeedInput"
                placeholder="https://example.com/feed.xml"
                class="form-input settings-search-input"
                required
                :disabled="addingPodcastShow"
              />
            </div>
            <select v-model="podcastShowVisibility" class="form-select" :disabled="addingPodcastShow">
              <option value="">Keep current (Public if new)</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="ultra_private">Ultra Private</option>
            </select>
            <button type="submit" class="btn btn-primary" :disabled="addingPodcastShow">
              <span v-if="addingPodcastShow">Adding...</span>
              <span v-else>Add Podcast</span>
            </button>
          </form>

          <div class="form-group mt-2">
            <label class="checkbox-container">
              <input type="checkbox" v-model="podcastAutoSync" :disabled="addingPodcastShow" />
              <span class="checkmark"></span>
              Sync automatically (start downloading right away)
            </label>
          </div>

          <div v-if="podcastIngestMessage" class="settings-form-msg mt-3" :class="podcastIngestSuccess ? 'settings-success-msg' : 'settings-error-msg'">
            {{ podcastIngestMessage }}
          </div>
        </div>

        <div class="ingest-box glass-panel mt-4">
          <div class="section-title-row">
            <div class="icon-orb bg-blue">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
            </div>
            <div>
              <h3>Followed Podcasts</h3>
              <p class="section-desc">{{ podcastShows.length }} show(s) tracked.</p>
            </div>
          </div>

          <div v-if="podcastShows.length === 0" class="mt-3">
            <p class="section-desc">No podcasts followed yet.</p>
          </div>
          <div v-else class="search-results-grid mt-3">
            <div v-for="s in podcastShows" :key="s.id" class="search-channel-card">
              <img
                :src="s.cover_url || '/img/default-avatar.png'"
                class="channel-avatar-thumb"
                referrerpolicy="no-referrer"
                @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
              />
              <div class="channel-search-info">
                <h5>{{ s.title }}</h5>
                <p class="channel-search-meta">
                  <span>{{ formatStatus(s.sync_status) }}</span>
                  <span class="meta-dot">•</span>
                  <span>{{ s.visibility }}</span>
                  <span class="meta-dot">•</span>
                  <span>{{ s.episode_count }} episode(s)</span>
                </p>
              </div>
              <button
                @click="handleSyncPodcastShow(s.id)"
                class="btn btn-primary btn-xs"
                :disabled="syncingShowId === s.id"
              >
                {{ syncingShowId === s.id ? 'Syncing...' : 'Sync' }}
              </button>
              <button
                v-if="s.sync_status === 'downloading'"
                @click="handlePausePodcastShow(s.id)"
                class="btn btn-secondary btn-xs"
                :disabled="pausingShowId === s.id"
              >
                {{ pausingShowId === s.id ? 'Pausing...' : 'Pause' }}
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
              <h3 style="margin: 0; font-size: 15px; font-weight: 700;">Podcast Queue</h3>
            </div>
            <span :class="podcastIsPaused ? 'badge-paused-global' : 'badge-active-global'">
              {{ podcastIsPaused ? 'Suspended' : 'Active' }}
            </span>
          </div>

          <div v-if="podcastQueue.length === 0" class="queue-empty-state">
            <h4>Podcast Pipeline Idle</h4>
            <p>Queue is empty.</p>
          </div>
          <div v-else class="queue-list-premium">
            <div v-for="ep in podcastQueue" :key="ep.id" class="queue-card-premium">
              <div class="queue-card-details">
                <div class="queue-card-meta-main">
                  <h4 class="queue-card-title" :title="ep.title">{{ ep.title }}</h4>
                  <span class="queue-card-channel-name">{{ ep.show_title }}</span>
                </div>
                <span class="status-badge" :class="`status-${ep.download_status}`">
                  {{ formatStatus(ep.download_status) }}
                </span>
              </div>

              <div class="queue-progress-container">
                <div class="progress-bar-glow-bg">
                  <div
                    class="progress-bar-glow-fill"
                    :style="{ width: (ep.download_progress || 0) + '%' }"
                  ></div>
                </div>
                <span class="progress-percent-text">{{ Math.round(ep.download_progress || 0) }}%</span>
              </div>

              <div class="queue-diagnostics-row" v-if="ep.download_status === 'downloading'">
                <span v-if="ep.download_speed" class="diag-meta-spec">Speed: {{ ep.download_speed }}</span>
                <span v-if="ep.download_eta" class="diag-meta-spec">ETA: {{ ep.download_eta }}</span>
              </div>

              <div class="queue-error-box" v-if="ep.download_status === 'failed' && ep.last_error">
                <strong>Log:</strong> {{ ep.last_error }}
              </div>

              <!-- No Cancel action: unlike music, the podcast admin API has no
                   per-episode cancel route, and adding one is out of scope for
                   this sub-project. Failed episodes get a single-episode retry. -->
              <div class="queue-card-action-bar" v-if="ep.download_status === 'failed'">
                <button
                  @click="handleRetryPodcastEpisode(ep.id)"
                  class="btn-action-premium"
                >
                  Retry
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
import { usePodcastQueue } from '~/composables/usePodcastQueue';

const toast = useToast();
const { podcastQueue, podcastShows, podcastIsPaused, podcastFailedCount, fetchPodcastQueue } = usePodcastQueue();

const retryingPodcastFailed = ref(false);
const pausingOrResumingPodcast = ref(false);
const maxConcurrentPodcastDownloads = ref(2);
const savingPodcastConcurrency = ref(false);
const podcastFeedInput = ref('');
const podcastShowVisibility = ref('');
const podcastAutoSync = ref(true);
const addingPodcastShow = ref(false);
const podcastIngestMessage = ref('');
const podcastIngestSuccess = ref(false);
const syncingShowId = ref<string | null>(null);
const pausingShowId = ref<string | null>(null);

const togglePodcastPause = async () => {
  pausingOrResumingPodcast.value = true;
  try {
    const endpoint = podcastIsPaused.value ? '/api/admin/podcasts/resume' : '/api/admin/podcasts/pause';
    await $fetch(endpoint, { method: 'POST' });
    podcastIsPaused.value = !podcastIsPaused.value;
    toast.success(podcastIsPaused.value ? 'Podcast downloads paused.' : 'Podcast downloads resumed.');
    fetchPodcastQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'An error occurred.');
  } finally {
    pausingOrResumingPodcast.value = false;
  }
};

const fetchPodcastConcurrency = async () => {
  try {
    const data = await $fetch<any>('/api/admin/podcasts/concurrency');
    maxConcurrentPodcastDownloads.value = data.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error('Failed to fetch podcast concurrency setting:', err);
  }
};

const handleSavePodcastConcurrency = async () => {
  savingPodcastConcurrency.value = true;
  try {
    await $fetch('/api/admin/podcasts/concurrency', {
      method: 'POST',
      body: { maxConcurrentDownloads: maxConcurrentPodcastDownloads.value }
    });
    toast.success('Podcast concurrency setting saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save podcast concurrency setting.');
  } finally {
    savingPodcastConcurrency.value = false;
  }
};

const savingPodcastSchedule = ref(false);
const podcastScheduleMessage = ref('');

const podcastScheduleForm = reactive({
  enabled: false,
  preset: 'daily',
  schedule: '0 4 * * *'
});

// 'daily'/'weekly' use 4:00 AM here (not music's 3:30 AM) to match the
// podcast_sync_cron_schedule default already seeded in db.ts: '0 4 * * *'.
const podcastPresets: Record<string, string> = {
  hourly: '0 * * * *',
  twelve_hours: '0 */12 * * *',
  daily: '0 4 * * *',
  weekly: '0 4 * * 0'
};

const applyPodcastPreset = () => {
  if (podcastScheduleForm.preset !== 'custom') {
    podcastScheduleForm.schedule = podcastPresets[podcastScheduleForm.preset] || '0 4 * * *';
  }
};

const fetchPodcastSchedule = async () => {
  try {
    const data = await $fetch<any>('/api/admin/podcasts/schedule');
    podcastScheduleForm.enabled = data.enabled;
    podcastScheduleForm.schedule = data.schedule || '0 4 * * *';

    const foundPreset = Object.keys(podcastPresets).find(k => podcastPresets[k] === podcastScheduleForm.schedule);
    podcastScheduleForm.preset = foundPreset || 'custom';
  } catch (err) {
    console.error('Failed to fetch podcast schedule:', err);
  }
};

const handleSavePodcastSchedule = async () => {
  savingPodcastSchedule.value = true;
  podcastScheduleMessage.value = '';
  try {
    await $fetch('/api/admin/podcasts/schedule', {
      method: 'POST',
      body: {
        enabled: podcastScheduleForm.enabled,
        schedule: podcastScheduleForm.schedule
      }
    });
    podcastScheduleMessage.value = 'Podcast synchronization frequency saved successfully.';
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingPodcastSchedule.value = false;
  }
};

const handleAddPodcastShow = async () => {
  const feedUrl = podcastFeedInput.value.trim();
  if (!feedUrl) return;

  addingPodcastShow.value = true;
  podcastIngestMessage.value = '';
  try {
    const res = await $fetch<any>('/api/admin/podcasts/ingest', {
      method: 'POST',
      body: {
        feedUrl,
        sync_status: podcastAutoSync.value ? 'downloading' : 'paused',
        ...(podcastShowVisibility.value ? { visibility: podcastShowVisibility.value } : {})
      }
    });
    podcastIngestSuccess.value = res.success;
    podcastIngestMessage.value = res.message;
    podcastFeedInput.value = '';
    toast.success('Podcast added.');
    fetchPodcastQueue();
  } catch (err: any) {
    // ingest.post.ts deliberately returns a single generic message for every
    // failure (sub-project 2's error-message-leakage fix) — surface it as-is.
    podcastIngestSuccess.value = false;
    podcastIngestMessage.value = err.data?.statusMessage || 'Failed to add podcast.';
    toast.error('Error adding podcast.');
  } finally {
    addingPodcastShow.value = false;
  }
};

const handleSyncPodcastShow = async (showId: string) => {
  syncingShowId.value = showId;
  try {
    await $fetch(`/api/admin/podcasts/shows/${showId}/sync`, { method: 'POST' });
    toast.success('Podcast sync started.');
    setTimeout(() => fetchPodcastQueue(), 3000);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to sync podcast.');
  } finally {
    syncingShowId.value = null;
  }
};

const handlePausePodcastShow = async (showId: string) => {
  pausingShowId.value = showId;
  try {
    await $fetch(`/api/admin/podcasts/shows/${showId}/pause`, { method: 'POST' });
    toast.success('Podcast sync paused.');
    fetchPodcastQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to pause podcast.');
  } finally {
    pausingShowId.value = null;
  }
};

const handleRetryPodcastEpisode = async (episodeId: string) => {
  try {
    await $fetch('/api/admin/podcasts/retry-failed', { method: 'POST', body: { episodeId } });
    toast.success('Episode retried.');
    fetchPodcastQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  }
};

const handleRetryAllPodcastFailed = async () => {
  retryingPodcastFailed.value = true;
  try {
    await $fetch('/api/admin/podcasts/retry-failed', { method: 'POST' });
    fetchPodcastQueue();
    toast.success('Failed downloads retried.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  } finally {
    retryingPodcastFailed.value = false;
  }
};

const formatStatus = (status: string) => {
  const s: Record<string, string> = {
    pending: 'Pending',
    downloading: 'Downloading',
    failed: 'Failed',
    completed: 'Completed',
    paused: 'Paused'
  };
  return s[status] || status;
};

onMounted(() => {
  fetchPodcastConcurrency();
  fetchPodcastSchedule();
});
</script>
