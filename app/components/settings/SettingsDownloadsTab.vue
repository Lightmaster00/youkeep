<template>
  <div class="tab-pane">
    <!-- Downloads Header & Controls Row -->
    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Downloads Manager & Queue</h2>
        <p>Add new channels, update background worker sync schedules, or control the download pipeline.</p>
      </div>

      <div class="queue-actions-row">
        <!-- Global Pause/Resume Button -->
        <button
          @click="toggleGlobalPause"
          class="btn"
          :class="isPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
          :disabled="pausingOrResuming"
        >
          <svg v-if="isPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          <span>{{ isPaused ? 'Resume Sync' : 'Pause Sync' }}</span>
        </button>

        <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
          <label for="max-concurrent-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
          <input
            id="max-concurrent-downloads"
            type="number"
            min="1"
            max="10"
            v-model.number="maxConcurrentDownloads"
            class="form-input"
            style="width: 64px;"
          />
          <button @click="handleSaveConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingConcurrency">
            {{ savingConcurrency ? 'Saving...' : 'Save' }}
          </button>
        </div>

        <button @click="handleSyncAll" class="btn btn-secondary-dark" :disabled="syncingAll">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2" :class="{ 'spin-anim': syncingAll }"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          <span>{{ syncingAll ? 'Syncing...' : 'Sync All Channels' }}</span>
        </button>

        <button v-if="failedCount > 0" @click="handleRetryAllFailed" class="btn btn-secondary-dark" :disabled="retryingFailed">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
          <span>Retry {{ failedCount }} Failed</span>
        </button>

        <button v-if="queue.length > 0" @click="handleClearQueue" class="btn btn-danger-outline btn-clean">
          Clear Queue
        </button>
      </div>
    </div>

    <div class="downloads-dashboard-layout">
      <!-- Left Side: Config & Ingest (60% width on desktop) -->
      <div class="downloads-main-col">
        <!-- Add Ingest / Channel Search Box -->
        <div class="ingest-box glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
            </div>
            <div>
              <h3>Track YouTube Channel</h3>
              <p class="section-desc">Search for a channel to add it to your local offline library.</p>
            </div>
          </div>

          <form @submit.prevent="handleSearchOrIngest" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="channelSearchInput"
                placeholder="Channel name (e.g. Marques Brownlee, Veritasium...)"
                class="form-input settings-search-input"
                required
                :disabled="searching || ingesting"
              />
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </div>
            <button type="submit" class="btn btn-primary" :disabled="searching || ingesting">
              <span v-if="searching">Searching...</span>
              <span v-else>Search Channel</span>
            </button>
          </form>

          <div v-if="ingestMessage" class="settings-form-msg mt-3" :class="ingestSuccess ? 'settings-success-msg' : 'settings-error-msg'">
            {{ ingestMessage }}
          </div>

          <!-- Search Results -->
          <div v-if="searchResults.length > 0" class="search-results-list mt-4">
            <h4 class="results-header">Matching Channels :</h4>
            <div class="search-results-grid">
              <div v-for="ch in searchResults" :key="ch.id" class="search-channel-card">
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
                <button @click="openIngestModal(ch)" class="btn btn-primary btn-xs">
                  Track
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Archiver System Policy Panel -->
        <div class="ingest-box glass-panel mt-4">
          <div class="section-title-row">
            <div class="icon-orb bg-blue">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </div>
            <div>
              <h3>Archiving Policy & Scheduling</h3>
              <p class="section-desc">Manage your downloads path and synchronize automation scheduling triggers.</p>
            </div>
          </div>

          <div class="policy-forms-grid mt-3">
            <!-- Storage Path Form -->
            <form @submit.prevent="handleSaveDefaultDir" class="policy-form-block">
              <div class="form-group">
                <label class="form-label" for="default_dir">Default Server Downloads Folder</label>
                <div class="input-action-row">
                  <input
                    type="text"
                    id="default_dir"
                    v-model="defaultDownloadsDir"
                    placeholder="e.g. /downloads/videos"
                    class="form-input"
                    required
                    :disabled="savingDir"
                  />
                  <button type="submit" class="btn btn-secondary-dark" :disabled="savingDir">
                    <span>{{ savingDir ? 'Saving...' : 'Apply Path' }}</span>
                  </button>
                </div>
              </div>
              <div v-if="saveDirMessage" class="settings-form-msg mt-2" :class="saveDirSuccess ? 'settings-success-msg' : 'settings-error-msg'">
                {{ saveDirMessage }}
              </div>
            </form>

            <!-- Scheduling Form -->
            <form @submit.prevent="handleSaveSchedule" class="policy-form-block mt-3 pt-3 border-t">
              <div class="form-group">
                <label class="checkbox-container">
                  <input type="checkbox" v-model="scheduleForm.enabled" />
                  <span class="checkmark"></span>
                  Enable background sync worker automation
                </label>
              </div>

              <div v-if="scheduleForm.enabled" class="schedule-settings-row mt-2">
                <div class="form-group flex-1">
                  <label class="form-label" for="preset">Preset Interval</label>
                  <select id="preset" v-model="scheduleForm.preset" @change="applyPreset" class="form-select">
                    <option value="hourly">Hourly (Every hour)</option>
                    <option value="twelve_hours">Every 12 hours</option>
                    <option value="daily">Daily (archiving at 3 AM)</option>
                    <option value="weekly">Weekly (Sunday at 3 AM)</option>
                    <option value="custom">Custom Cron Expression</option>
                  </select>
                </div>

                <div class="form-group flex-1" v-if="scheduleForm.preset === 'custom'">
                  <label class="form-label" for="cron">Cron Expression</label>
                  <input type="text" id="cron" v-model="scheduleForm.schedule" class="form-input" placeholder="*/30 * * * *" required />
                </div>
              </div>

              <div class="form-actions mt-3">
                <button type="submit" class="btn btn-secondary-dark" :disabled="savingSchedule">
                  {{ savingSchedule ? 'Saving...' : 'Save Sync Trigger' }}
                </button>
              </div>
            </form>
            <div v-if="scheduleMessage" class="settings-form-msg mt-3 settings-success-msg">
              {{ scheduleMessage }}
            </div>
          </div>
        </div>

        <div class="ingest-box glass-panel mt-4">
          <div class="section-title-row">
            <div class="icon-orb bg-blue">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </div>
            <div>
              <h3>Sponsor Segment Handling</h3>
              <p class="section-desc">Applies to new downloads only, using the community SponsorBlock database. Each category can be ignored, marked as a chapter, or cut from the file.</p>
            </div>
          </div>

          <form @submit.prevent="handleSaveSponsorBlock" class="policy-forms-grid mt-3">
            <div class="form-group" v-for="cat in sponsorBlockCategoryList" :key="cat.key">
              <label class="form-label" :for="`sb-${cat.key}`">{{ cat.label }}</label>
              <select :id="`sb-${cat.key}`" v-model="sponsorBlockSettings[cat.key]" class="form-select">
                <option value="ignore">Ignore</option>
                <option value="mark">Mark as chapter</option>
                <option value="remove">Remove from file</option>
              </select>
            </div>

            <div class="form-actions mt-3">
              <button type="submit" class="btn btn-secondary-dark" :disabled="savingSponsorBlock">
                {{ savingSponsorBlock ? 'Saving...' : 'Save SponsorBlock Settings' }}
              </button>
            </div>
          </form>
          <div v-if="sponsorBlockMessage" class="settings-form-msg mt-3" :class="sponsorBlockSuccess ? 'settings-success-msg' : 'settings-error-msg'">
            {{ sponsorBlockMessage }}
          </div>
        </div>
      </div>

      <!-- Right Side: Processing Queue (40% width on desktop) -->
      <div class="downloads-side-col">
        <div class="queue-box glass-panel">
          <div class="queue-header-row">
            <div class="flex-align-center gap-10">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-secondary);"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              <h3 style="margin: 0; font-size: 15px; font-weight: 700;">Worker Queue</h3>
            </div>
            <span :class="isPaused ? 'badge-paused-global' : 'badge-active-global'">
              {{ isPaused ? 'Suspended' : 'Active' }}
            </span>
          </div>

          <div v-if="queue.length === 0" class="queue-empty-state">
            <div class="empty-icon-cloud">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19A3.5 3.5 0 0 0 21 15.5a3.42 3.42 0 0 0-.22-1.2A3.5 3.5 0 0 0 17.5 11h-1a7 7 0 0 0-14 0h-1a3.5 3.5 0 0 0 0 7h16.5z"></path><polyline points="12 18 12 12 15 15"></polyline></svg>
            </div>
            <h4>Archive Pipeline Idle</h4>
            <p>Queue is empty. Active channels are queried automatically.</p>
          </div>
          <div v-else class="queue-list-premium">
            <div v-for="video in queue" :key="video.id" class="queue-card-premium">
              <div class="queue-card-details">
                <div class="queue-card-meta-main">
                  <h4 class="queue-card-title" :title="video.title">{{ video.title }}</h4>
                  <span class="queue-card-channel-name">{{ video.channel_title }}</span>
                </div>
                <span class="status-badge" :class="`status-${video.download_status}`">
                  {{ formatStatus(video.download_status) }}
                </span>
              </div>

              <!-- Progress Bar Component -->
              <div class="queue-progress-container">
                <div class="progress-bar-glow-bg">
                  <div
                    class="progress-bar-glow-fill"
                    :style="{ width: (smoothProgress[video.id] !== undefined ? smoothProgress[video.id] : (video.download_progress || 0)) + '%' }"
                  ></div>
                </div>
                <span class="progress-percent-text">{{ Math.round(smoothProgress[video.id] !== undefined ? smoothProgress[video.id] : (video.download_progress || 0)) }}%</span>
              </div>

              <div class="queue-diagnostics-row" v-if="video.download_status === 'downloading'">
                <span v-if="video.download_speed" class="diag-meta-spec">Speed: {{ video.download_speed }}</span>
                <span v-if="video.download_eta" class="diag-meta-spec">ETA: {{ video.download_eta }}</span>
              </div>

              <div class="queue-error-box" v-if="video.download_status === 'failed' && video.last_error">
                <strong>Log:</strong> {{ video.last_error }}
              </div>

              <div class="queue-card-action-bar">
                <button
                  v-if="video.download_status === 'pending'"
                  @click="handlePrioritizeTask(video.id)"
                  class="btn-action-premium"
                >
                  Prioritize
                </button>
                <button
                  @click="handleCancelDownload(video.id)"
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

  <!-- Ingest Options Modal -->
  <div v-if="showIngestModal" class="modal-overlay" @click.self="closeIngestModal">
    <div class="modal-content glass-panel">
      <div class="modal-header">
        <h3>Archiving options: {{ selectedSearchChannel?.title }}</h3>
        <button @click="closeIngestModal" class="btn-close">&times;</button>
      </div>

      <form @submit.prevent="submitIngestModal" class="modal-body mt-3">
        <div class="form-group">
          <label class="form-label" for="custom_path">Storage Folder (full path on the server)</label>
          <input
            type="text"
            id="custom_path"
            v-model="modalForm.custom_save_path"
            class="form-input"
            placeholder="e.g. /downloads/videos/channel_name"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="visibility">Default Visibility</label>
          <select id="visibility" v-model="modalForm.visibility" class="form-select">
            <option value="public">Public (Everyone can view)</option>
            <option value="private">Private (Logged-in users only)</option>
            <option value="unlisted">Unlisted (Restricted to explicit permissions)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Content to archive</label>
          <div class="checkbox-row mt-1" style="display: flex; gap: 16px;">
            <label class="checkbox-container">
              <input type="checkbox" v-model="modalForm.download_videos" />
              <span class="checkmark"></span>
              Videos
            </label>
            <label class="checkbox-container">
              <input type="checkbox" v-model="modalForm.download_shorts" />
              <span class="checkmark"></span>
              Shorts
            </label>
          </div>
        </div>



        <div class="form-group mt-3">
          <label class="checkbox-container">
            <input type="checkbox" v-model="modalForm.sync_automatically" />
            <span class="checkmark"></span>
            Automatically synchronize this channel (Scheduling)
          </label>
        </div>

        <div class="form-group">
          <label class="checkbox-container">
            <input type="checkbox" v-model="modalForm.start_sync" />
            <span class="checkmark"></span>
            Start synchronization and download immediately
          </label>
        </div>

        <div class="modal-footer mt-4" style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" @click="closeIngestModal" class="btn btn-secondary">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="ingesting">
            {{ ingesting ? 'Adding...' : 'Confirm' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';
import { useAdminChannels } from '~/composables/useAdminChannels';

const toast = useToast();
const { queue, failedCount, isPaused, smoothProgress, fetchQueue } = useDownloadsQueue();
const { refreshStats } = await useAdminChannels();

const syncingAll = ref(false);
const retryingFailed = ref(false);
const pausingOrResuming = ref(false);
const maxConcurrentDownloads = ref(2);
const savingConcurrency = ref(false);

const parseETAToSeconds = (etaStr: string | null | undefined): number => {
  if (!etaStr) return 0;
  const cleaned = etaStr.trim();
  if (cleaned === '--:--' || cleaned.toLowerCase().includes('waiting')) return 0;
  const parts = cleaned.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  } else if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }
  return 0;
};

const toggleGlobalPause = async () => {
  pausingOrResuming.value = true;
  try {
    const endpoint = isPaused.value ? '/api/admin/downloader/resume' : '/api/admin/downloader/pause';
    await $fetch(endpoint, { method: 'POST' });
    isPaused.value = !isPaused.value;
    toast.success(isPaused.value ? 'Downloads paused.' : 'Downloads resumed.');
    fetchQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'An error occurred.');
  } finally {
    pausingOrResuming.value = false;
  }
};

const fetchConcurrency = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/concurrency');
    maxConcurrentDownloads.value = data.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error('Failed to fetch concurrency setting:', err);
  }
};

const handleSaveConcurrency = async () => {
  savingConcurrency.value = true;
  try {
    await $fetch('/api/admin/downloader/concurrency', {
      method: 'POST',
      body: { maxConcurrentDownloads: maxConcurrentDownloads.value }
    });
    toast.success('Concurrency setting saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save concurrency setting.');
  } finally {
    savingConcurrency.value = false;
  }
};

const handleSyncAll = async () => {
  syncingAll.value = true;
  try {
    const res = await $fetch<any>('/api/admin/downloader/sync-all', { method: 'POST' });
    toast.success(res.message || 'Sync started.');
    fetchQueue();
    refreshStats();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Launch failed.');
  } finally {
    syncingAll.value = false;
  }
};

const handleRetryAllFailed = async () => {
  retryingFailed.value = true;
  try {
    await $fetch('/api/admin/downloader/retry-failed', { method: 'POST' });
    fetchQueue();
    toast.success('Failed downloads retried.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  } finally {
    retryingFailed.value = false;
  }
};

const handleClearQueue = async () => {
  if (!confirm('Do you want to clear the entire queue (unstarted videos will be removed)?')) return;
  try {
    await $fetch('/api/admin/downloader/clear-queue', { method: 'POST' });
    fetchQueue();
    toast.success('Queue cleared.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};

const handlePrioritizeTask = async (videoId: string) => {
  try {
    await $fetch('/api/admin/downloader/prioritize', {
      method: 'POST',
      body: { videoId }
    });
    fetchQueue();
    toast.success('Download set as priority.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed.');
  }
};

const handleCancelDownload = async (videoId: string) => {
  try {
    await $fetch('/api/admin/downloader/cancel', {
      method: 'POST',
      body: { videoId }
    });
    fetchQueue();
    toast.success('Download cancelled.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Cancellation failed.');
  }
};

const channelSearchInput = ref('');
const searching = ref(false);
const searchResults = ref<any[]>([]);
const ingesting = ref(false);
const ingestMessage = ref('');
const ingestSuccess = ref(false);

const defaultDownloadsDir = ref('');
const savingDir = ref(false);
const saveDirMessage = ref('');
const saveDirSuccess = ref(false);

const sponsorBlockCategoryList = [
  { key: 'sponsor', label: 'Sponsor' },
  { key: 'intro', label: 'Intro' },
  { key: 'outro', label: 'Outro' },
  { key: 'selfpromo', label: 'Self-Promo' },
  { key: 'interaction', label: 'Like/Subscribe Reminders' },
  { key: 'filler', label: 'Filler / Tangents' },
];
const sponsorBlockSettings = ref<Record<string, string>>({
  sponsor: 'ignore', intro: 'ignore', outro: 'ignore', selfpromo: 'ignore', interaction: 'ignore', filler: 'ignore'
});
const savingSponsorBlock = ref(false);
const sponsorBlockMessage = ref('');
const sponsorBlockSuccess = ref(false);

const fetchSponsorBlockSettings = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/sponsorblock');
    sponsorBlockSettings.value = data.settings;
  } catch (e) {
    console.error('Failed to fetch SponsorBlock settings:', e);
  }
};

const handleSaveSponsorBlock = async () => {
  savingSponsorBlock.value = true;
  sponsorBlockMessage.value = '';
  try {
    await $fetch('/api/admin/downloader/sponsorblock', {
      method: 'POST',
      body: sponsorBlockSettings.value
    });
    sponsorBlockSuccess.value = true;
    sponsorBlockMessage.value = 'SponsorBlock settings saved.';
  } catch (e: any) {
    sponsorBlockSuccess.value = false;
    sponsorBlockMessage.value = e?.data?.statusMessage || 'Failed to save settings.';
  } finally {
    savingSponsorBlock.value = false;
  }
};

const fetchDefaultDir = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/default-dir');
    defaultDownloadsDir.value = data.path || '/downloads/videos';
  } catch (err) {
    console.error('Failed to fetch default downloads directory:', err);
  }
};

const handleSaveDefaultDir = async () => {
  savingDir.value = true;
  saveDirMessage.value = '';
  saveDirSuccess.value = false;
  try {
    await $fetch('/api/admin/downloader/default-dir', {
      method: 'POST',
      body: {
        path: defaultDownloadsDir.value
      }
    });
    saveDirSuccess.value = true;
    saveDirMessage.value = 'Default downloads folder saved successfully.';
    toast.success('Default folder updated.');
  } catch (err: any) {
    saveDirSuccess.value = false;
    saveDirMessage.value = err.data?.statusMessage || 'Save failed.';
    toast.error(saveDirMessage.value);
  } finally {
    savingDir.value = false;
  }
};

const handleSearchOrIngest = async () => {
  const query = channelSearchInput.value.trim();
  if (!query) return;

  if (query.startsWith('http://') || query.startsWith('https://') || query.includes('youtube.com/')) {
    openIngestModal({
      id: null,
      title: 'Channel via URL',
      avatarUrl: '',
      handle: query,
      isDirectUrl: true
    });
  } else {
    searching.value = true;
    ingestMessage.value = '';
    searchResults.value = [];
    try {
      const data = await $fetch<any>('/api/admin/downloader/search-channels', {
        params: { q: query }
      });
      searchResults.value = data.channels || [];
      if (searchResults.value.length === 0) {
        toast.info('No channels found for this search.');
      }
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Search failed.');
    } finally {
      searching.value = false;
    }
  }
};

const showIngestModal = ref(false);
const selectedSearchChannel = ref<any>(null);
const modalForm = reactive({
  custom_save_path: '',
  visibility: 'public',
  download_videos: true,
  download_shorts: false,
  date_after: '',
  sync_automatically: true,
  start_sync: true
});

const openIngestModal = (channel: any) => {
  selectedSearchChannel.value = channel;
  const baseDir = defaultDownloadsDir.value || '/downloads/videos';
  const cleanTitle = channel.title ? channel.title.replace(/[\\/:*?"<>|]/g, '_').trim() : (channel.id || '');
  modalForm.custom_save_path = `${baseDir}/${cleanTitle}`.replace(/\/+/g, '/');
  modalForm.visibility = 'public';
  modalForm.download_videos = true;
  modalForm.download_shorts = false;
  modalForm.date_after = '';
  modalForm.sync_automatically = true;
  modalForm.start_sync = true;
  showIngestModal.value = true;
};

const closeIngestModal = () => {
  showIngestModal.value = false;
  selectedSearchChannel.value = null;
};

const submitIngestModal = async () => {
  if (!selectedSearchChannel.value) return;

  ingesting.value = true;
  ingestMessage.value = '';
  showIngestModal.value = false;

  const targetUrl = selectedSearchChannel.value.isDirectUrl
    ? selectedSearchChannel.value.handle
    : `https://www.youtube.com/channel/${selectedSearchChannel.value.id}`;

  try {
    const res = await $fetch<any>('/api/admin/downloader/ingest', {
      method: 'POST',
      body: {
        url: targetUrl,
        download_videos: modalForm.download_videos,
        download_shorts: modalForm.download_shorts,
        date_after: modalForm.date_after ? modalForm.date_after.replace(/-/g, '') : undefined,
        sync_status: modalForm.sync_automatically ? 'active' : 'paused',
        visibility: modalForm.visibility,
        custom_save_path: modalForm.custom_save_path || undefined,
        start_sync: modalForm.start_sync
      }
    });

    ingestSuccess.value = res.success;
    ingestMessage.value = res.message;
    channelSearchInput.value = '';
    searchResults.value = [];
    fetchQueue();
    refreshStats();
    toast.success('Channel imported successfully!');
  } catch (err: any) {
    ingestSuccess.value = false;
    ingestMessage.value = err.data?.statusMessage || 'Import failed.';
    toast.error('Error importing channel.');
  } finally {
    ingesting.value = false;
  }
};

const savingSchedule = ref(false);
const scheduleMessage = ref('');

const scheduleForm = reactive({
  enabled: false,
  preset: 'daily',
  schedule: '0 3 * * *'
});

const presets: Record<string, string> = {
  hourly: '0 * * * *',
  twelve_hours: '0 */12 * * *',
  daily: '0 3 * * *',
  weekly: '0 3 * * 0'
};

const applyPreset = () => {
  if (scheduleForm.preset !== 'custom') {
    scheduleForm.schedule = presets[scheduleForm.preset] || '0 3 * * *';
  }
};

const fetchSchedule = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/schedule');
    scheduleForm.enabled = data.enabled;
    scheduleForm.schedule = data.schedule || '0 3 * * *';

    // Find preset matching schedule
    const foundPreset = Object.keys(presets).find(k => presets[k] === scheduleForm.schedule);
    scheduleForm.preset = foundPreset || 'custom';
  } catch (err) {
    console.error('Failed to fetch schedule:', err);
  }
};

const handleSaveSchedule = async () => {
  savingSchedule.value = true;
  scheduleMessage.value = '';
  try {
    await $fetch('/api/admin/downloader/schedule', {
      method: 'POST',
      body: {
        enabled: scheduleForm.enabled,
        schedule: scheduleForm.schedule
      }
    });
    scheduleMessage.value = 'Synchronization frequency saved successfully.';
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingSchedule.value = false;
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
  fetchSchedule();
  fetchDefaultDir();
  fetchSponsorBlockSettings();
  fetchConcurrency();
});
</script>
