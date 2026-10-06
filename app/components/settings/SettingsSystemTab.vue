<template>
  <div class="tab-pane system-tab">
    <section class="config-section glass-panel" data-testid="system-modules">
      <div class="section-title-row">
      <div class="icon-orb bg-pink">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      </div>
        <div>
          <h3>Modules</h3>
          <p class="section-desc">Turn each space on or off for everyone except admins. A space that is off disappears from the menus and stops downloading and syncing in the background; its files and data are kept. Admins can still open it.</p>
        </div>
      </div>
    <div class="mt-3" style="display: flex; flex-direction: column; gap: 12px;">
      <label
        v-for="m in moduleOptions"
        :key="m.id"
        style="display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer;"
      >
        <span>
          <strong>{{ m.label }}</strong>
          <span class="section-desc" style="display: block; margin: 2px 0 0;">{{ m.description }}</span>
          <span v-if="isLastEnabledModule(m.id)" class="section-desc" style="display: block; margin: 2px 0 0;">At least one space must stay on.</span>
        </span>
        <span style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
          <input
            type="checkbox"
            :checked="modules[m.id]"
            :disabled="savingModuleId !== null || isLastEnabledModule(m.id)"
            @change="onModuleChange(m.id, $event)"
          />
          <span>{{ modules[m.id] ? 'On' : 'Off' }}</span>
        </span>
      </label>
    </div>
    </section>

    <section class="config-section glass-panel" data-testid="system-default-display">
      <div class="section-title-row">
      <div class="icon-orb bg-pink">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
      </div>
        <div>
          <h3>Default display</h3>
          <p class="section-desc">Starting display settings for the whole server, for guests and users. Each user can change them from their account.</p>
        </div>
      </div>
    <div class="mt-3">
      <DisplayPrefsForm mode="admin" />
    </div>
    </section>

    <section class="config-section glass-panel" data-testid="system-search">
      <div class="section-title-row">
      <div class="icon-orb bg-pink">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </div>
        <div>
          <h3>Search providers</h3>
          <p class="section-desc">Optional API keys that give better results when you search for podcasts and YouTube channels to follow, and how the search bar at the top of the page works.</p>
        </div>
      </div>
    <div v-for="platform in searchPlatforms" :key="platform.id" class="mt-3 pt-3 border-t">
      <h4 class="results-header">{{ platformLabels[platform.id] }}</h4>
      <form @submit.prevent="handleSaveSearchPlatform(platform.id)" class="ingest-form mt-2">
        <div class="search-input-wrapper">
          <input
            type="text"
            v-model="platform.apiKey"
            placeholder="API Key"
            class="form-input settings-search-input"
            :disabled="savingPlatformId === platform.id"
          />
        </div>
        <div class="search-input-wrapper" v-if="platform.id === 'podcastindex'">
          <input
            type="password"
            v-model="platform.apiSecret"
            placeholder="API Secret"
            class="form-input settings-search-input"
            :disabled="savingPlatformId === platform.id"
          />
        </div>
        <button type="submit" class="btn btn-secondary-dark" :disabled="savingPlatformId === platform.id">
          {{ savingPlatformId === platform.id ? 'Saving...' : 'Save' }}
        </button>
      </form>
    </div>
      <div class="mt-3 pt-3 border-t">
        <h4 class="results-header">Header search bar</h4>
        <p class="section-desc">Search inside the current space only, or search videos, music and podcasts together on one results page.</p>
        <div class="mt-2">
          <select v-model="contentSearchMode" class="form-select" :disabled="savingContentSearchMode" @change="handleSaveContentSearchMode">
            <option value="per_space">Current space only</option>
            <option value="global">All spaces together</option>
          </select>
        </div>
      </div>
    </section>

    <details class="config-section glass-panel" data-testid="system-tools" @toggle="onToolsToggle">
      <summary class="system-summary">
        <span class="system-chevron" aria-hidden="true"></span>
        <span class="system-summary-text">
          <span class="system-summary-title">Tools &amp; logs</span>
          <span class="section-desc">Check and update the download engine (yt-dlp and FFmpeg) and read the server's recent log.</span>
        </span>
      </summary>
      <div class="system-tools-body">
        <h4 class="results-header">Download engine</h4>
        <p class="section-desc">Check that yt-dlp and FFmpeg work on this server.</p>
    <div class="binary-path-box mt-3">
      <span class="path-label">yt-dlp path:</span>
      <code class="path-code">{{ diagnosticYtdlPath || 'Looking up...' }}</code>
    </div>

    <div class="btn-group mt-3" style="width: 100%; display: flex; gap: 10px;">
      <button @click="handleTestBinary" class="btn btn-secondary-dark flex-1" :disabled="diagnosticBinaryTesting">
        {{ diagnosticBinaryTesting ? 'Testing...' : 'Run check' }}
      </button>

      <button @click="handleUpdateYtdl" class="btn btn-secondary-dark flex-1" :disabled="updatingYtdl">
        {{ updatingYtdl ? 'Updating...' : 'Update yt-dlp' }}
      </button>
    </div>

    <!-- Diagnostics results panel -->
    <div v-if="diagnosticBinaryResult" class="test-result-box mt-3 border-t pt-3">
      <div class="diagnostic-status-item">
        <span class="diagnostic-label">yt-dlp:</span>
        <span :class="diagnosticBinaryResult.success ? 'badge-status badge-success' : 'badge-status badge-danger'">
          {{ diagnosticBinaryResult.success ? 'Working' : 'Error' }}
        </span>
        <div v-if="diagnosticBinaryResult.success" class="diagnostic-version-sub mt-1">
          Version: <code>{{ diagnosticBinaryResult.version }}</code>
        </div>
      </div>

      <div class="diagnostic-status-item mt-3">
        <span class="diagnostic-label">FFmpeg:</span>
        <span :class="diagnosticBinaryResult.ffmpegAvailable ? 'badge-status badge-success' : 'badge-status badge-warning'">
          {{ diagnosticBinaryResult.ffmpegAvailable ? 'Found' : 'Not detected' }}
        </span>
      </div>

      <div v-if="!diagnosticBinaryResult.ffmpegAvailable" class="ffmpeg-warning-box mt-3">
        <strong class="warning-title">Without FFmpeg, downloads are limited to 720p:</strong>
        <p class="warning-desc">FFmpeg was not detected in system execution paths. Thumbnails cannot be converted to JPG, and downloads will be capped at combined formats. Install <code>ffmpeg</code> on the host system to enable high-quality (1080p, 4K) downloads.</p>
      </div>

      <div v-if="diagnosticBinaryResult.stderr" class="diagnostic-stderr-box mt-3">
        <h5>Error output:</h5>
        <pre class="diagnostic-pre mt-1">{{ diagnosticBinaryResult.stderr }}</pre>
      </div>
    </div>

    <div v-if="updatingYtdl || updateConsoleOutput" class="test-result-box mt-3 border-t pt-3">
      <h4>Update output:</h4>
      <pre class="diagnostic-pre mt-2">{{ updateConsoleOutput || 'Updating yt-dlp...' }}</pre>
    </div>
  <div class="logs-container glass-panel">
    <div class="logs-header">
      <div class="flex-align-center gap-10">
        <span class="terminal-dot green"></span>
        <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: white;">Server log</h3>
      </div>
      <button @click="fetchDiagnostics" class="btn btn-secondary-dark btn-icon-sm" title="Refresh log">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
      </button>
    </div>
    <div class="logs-terminal" ref="terminalBody">
      <div v-if="diagnosticLogs.length === 0" class="log-line text-muted">
        The log is empty.
      </div>
      <div
        v-for="(log, idx) in diagnosticLogs"
        :key="idx"
        class="log-line"
        :class="getLogLineClass(log)"
      >
        {{ log }}
      </div>
    </div>
  </div>
      </div>
    </details>

    <details class="config-section glass-panel danger-zone-panel" data-testid="system-danger">
      <summary class="system-summary">
        <span class="system-chevron" aria-hidden="true"></span>
        <span class="system-summary-text">
          <span class="system-summary-title">Danger zone</span>
          <span class="section-desc">Permanently delete every video, music track and podcast episode — files and database records. This cannot be undone.</span>
        </span>
      </summary>
  <div v-if="wipeInProgress" class="mt-3 danger-zone-progress">
    <p v-if="wipeCurrent">
      Deleting: {{ wipeCurrent.type }} "{{ wipeCurrent.name }}" ({{ wipeCurrent.index }}/{{ wipeCurrent.total }})
    </p>
    <p v-else>Starting...</p>
  </div>

  <div v-else-if="wipeReport" class="mt-3 danger-zone-report">
    <p class="settings-success-msg">{{ wipeReport.succeeded.length }} item(s) deleted successfully.</p>
    <div v-if="wipeReport.failed.length > 0" class="settings-error-msg mt-2">
      <p>{{ wipeReport.failed.length }} item(s) failed:</p>
      <ul>
        <li v-for="f in wipeReport.failed" :key="f.id">{{ f.type }} "{{ f.name }}": {{ f.error }}</li>
      </ul>
    </div>
    <button @click="resetDangerZone" class="btn btn-secondary-dark mt-3">Done</button>
  </div>

  <div v-else-if="!wipePreview" class="mt-3">
    <button @click="loadWipePreview" class="btn btn-secondary-dark" :disabled="loadingWipePreview">
      {{ loadingWipePreview ? 'Loading...' : 'Show what will be deleted' }}
    </button>
  </div>

  <div v-else class="mt-3 danger-zone-preview">
    <p class="danger-zone-summary">
      This will permanently delete
      <strong>{{ wipePreview.channelCount }}</strong> channel(s) ({{ wipePreview.videoCount }} video(s)),
      <strong>{{ wipePreview.artistCount }}</strong> artist(s) ({{ wipePreview.trackCount }} track(s)), and
      <strong>{{ wipePreview.showCount }}</strong> show(s) ({{ wipePreview.episodeCount }} episode(s)) —
      an estimated <strong>{{ formatBytes(wipePreview.estimatedBytes) }}</strong> of files.
    </p>
    <p class="danger-zone-hint">Type <code>{{ WIPE_CONFIRM_WORD }}</code> below to enable the button.</p>
    <input
      v-model="wipeConfirmText"
      type="text"
      class="form-input mt-2"
      :placeholder="WIPE_CONFIRM_WORD"
      :disabled="startingWipe"
    />
    <button
      @click="handleStartWipe"
      class="btn btn-danger mt-3"
      :disabled="wipeConfirmText !== WIPE_CONFIRM_WORD || startingWipe"
    >
      {{ startingWipe ? 'Starting...' : 'Delete everything' }}
    </button>
  </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';

const toast = useToast();
const WIPE_CONFIRM_WORD = 'DELETE';
const { diagnosticLogs, diagnosticYtdlPath, fetchDiagnostics } = useDownloadsQueue();

const terminalBody = ref<HTMLElement | null>(null);

watch(diagnosticLogs, () => {
  setTimeout(() => {
    if (terminalBody.value) {
      terminalBody.value.scrollTop = terminalBody.value.scrollHeight;
    }
  }, 50);
});

const getLogLineClass = (log: string) => {
  const l = log.toLowerCase();
  if (l.includes('[error]') || l.includes('error') || l.includes('failed')) return 'log-error';
  if (l.includes('[warning]') || l.includes('warning')) return 'log-warning';
  if (l.includes('success') || l.includes('completed') || l.includes('finished')) return 'log-success';
  if (l.includes('starting') || l.includes('started') || l.includes('info')) return 'log-info';
  return 'log-default';
};

const diagnosticBinaryTesting = ref(false);
const diagnosticBinaryResult = ref<any>(null);
const updatingYtdl = ref(false);
const updateConsoleOutput = ref('');

const handleTestBinary = async () => {
  diagnosticBinaryTesting.value = true;
  diagnosticBinaryResult.value = null;
  try {
    const res = await $fetch<any>('/api/admin/downloader/test-binary', { method: 'POST' });
    diagnosticBinaryResult.value = res;
    toast.success('Check finished.');
  } catch (err: any) {
    diagnosticBinaryResult.value = {
      success: false,
      stderr: err.data?.statusMessage || err.message || 'Unknown error'
    };
    toast.error('Check failed.');
  } finally {
    diagnosticBinaryTesting.value = false;
  }
};

const handleUpdateYtdl = async () => {
  updatingYtdl.value = true;
  updateConsoleOutput.value = 'Launching update...';
  try {
    const res = await $fetch<any>('/api/admin/downloader/update-ytdl', { method: 'POST' });
    updateConsoleOutput.value = res.output || 'Update completed successfully.';
    toast.success('yt-dlp updated.');
  } catch (err: any) {
    updateConsoleOutput.value = err.data?.statusMessage || err.message || 'Update failed.';
    toast.error('Update failed.');
  } finally {
    updatingYtdl.value = false;
  }
};

const wipePreview = ref<{
  channelCount: number; videoCount: number;
  artistCount: number; trackCount: number;
  showCount: number; episodeCount: number;
  estimatedBytes: number;
} | null>(null);
const loadingWipePreview = ref(false);
const wipeConfirmText = ref('');
const startingWipe = ref(false);
const wipeInProgress = ref(false);
const wipeCurrent = ref<{ type: string; name: string; index: number; total: number } | null>(null);
const wipeReport = ref<{ succeeded: any[]; failed: any[] } | null>(null);
let wipePollTimeout: any = null;

async function loadWipePreview() {
  loadingWipePreview.value = true;
  try {
    wipePreview.value = await $fetch('/api/admin/system/wipe-preview');
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Failed to load the wipe preview.');
  } finally {
    loadingWipePreview.value = false;
  }
}

async function handleStartWipe() {
  if (wipeConfirmText.value !== WIPE_CONFIRM_WORD) return;
  startingWipe.value = true;
  try {
    await $fetch('/api/admin/system/wipe-all', { method: 'POST' });
    wipeInProgress.value = true;
    wipeConfirmText.value = '';
    pollWipeStatus();
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Failed to start the wipe.');
  } finally {
    startingWipe.value = false;
  }
}

async function pollWipeStatus() {
  try {
    const status = await $fetch<{ inProgress: boolean; current: any; report: any }>('/api/admin/system/wipe-status');
    wipeInProgress.value = status.inProgress;
    wipeCurrent.value = status.current;
    if (!status.inProgress && status.report) {
      wipeReport.value = status.report;
      return;
    }
  } catch (e) {
    // Keep polling even on a transient fetch error: a single failed request
    // must not leave the wipe progress frozen.
  }
  wipePollTimeout = setTimeout(pollWipeStatus, 1000);
}

onUnmounted(() => {
  if (wipePollTimeout) clearTimeout(wipePollTimeout);
});

function resetDangerZone() {
  wipeReport.value = null;
  wipePreview.value = null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

const searchPlatforms = ref<{ id: string; apiKey: string; apiSecret: string }[]>([]);
const savingPlatformId = ref<string | null>(null);
const platformLabels: Record<string, string> = {
  podcastindex: 'PodcastIndex',
  listennotes: 'Listen Notes',
  youtube_data_api: 'YouTube Data API'
};

const fetchSearchPlatforms = async () => {
  try {
    const data = await $fetch<any>('/api/admin/system/search-platforms');
    searchPlatforms.value = data.platforms || [];
  } catch (err) {
    console.error('Failed to fetch search platforms:', err);
  }
};

const handleSaveSearchPlatform = async (id: string) => {
  const platform = searchPlatforms.value.find((p) => p.id === id);
  if (!platform) return;

  savingPlatformId.value = id;
  try {
    await $fetch('/api/admin/system/search-platforms', {
      method: 'POST',
      body: { id: platform.id, apiKey: platform.apiKey, apiSecret: platform.apiSecret }
    });
    toast.success(`${platformLabels[id]} credentials saved.`);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || `Failed to save ${platformLabels[id]} credentials.`);
  } finally {
    savingPlatformId.value = null;
  }
};

const contentSearchMode = ref('per_space');
const savingContentSearchMode = ref(false);

const fetchContentSearchMode = async () => {
  try {
    const data = await $fetch<any>('/api/settings/content-search-mode');
    contentSearchMode.value = data.mode || 'per_space';
  } catch (err) {
    console.error('Failed to fetch content search mode:', err);
  }
};

const handleSaveContentSearchMode = async () => {
  savingContentSearchMode.value = true;
  try {
    await $fetch('/api/admin/settings/content-search-mode', {
      method: 'POST',
      body: { mode: contentSearchMode.value }
    });
    toast.success('Search mode updated.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Could not update the search mode.');
  } finally {
    savingContentSearchMode.value = false;
  }
};

type ModuleKey = 'video' | 'music' | 'podcasts';

const { modules, refresh: refreshModules } = useModules();
const savingModuleId = ref<ModuleKey | null>(null);

const moduleOptions: { id: ModuleKey; label: string; description: string }[] = [
  { id: 'video', label: 'Videos', description: 'Home, Shorts, Channels, Subscriptions, Playlists and the video player.' },
  { id: 'music', label: 'Music', description: 'Music library, artists and the audio player.' },
  { id: 'podcasts', label: 'Podcasts', description: 'Podcast library and player.' },
];

const enabledModuleCount = computed(() => moduleOptions.filter((m) => modules.value[m.id]).length);
const isLastEnabledModule = (id: ModuleKey) => modules.value[id] && enabledModuleCount.value === 1;

const onModuleChange = async (id: ModuleKey, event: Event) => {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  savingModuleId.value = id;
  try {
    await $fetch('/api/admin/settings/modules', { method: 'POST', body: { [id]: enabled } });
    toast.success(enabled ? 'Space turned on.' : 'Space turned off.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Could not update this space.');
  } finally {
    // Always re-read the truth from the server so the switches and the space
    // switcher reflect what was actually saved (e.g. after a refused change).
    await refreshModules();
    // The browser already flipped the box natively; force it back to server truth.
    input.checked = !!modules.value[id];
    savingModuleId.value = null;
  }
};

function onToolsToggle(event: Event) {
  if ((event.target as HTMLDetailsElement).open) fetchDiagnostics();
}

onMounted(() => {
  refreshModules();
  fetchSearchPlatforms();
  fetchContentSearchMode();
  fetchDiagnostics();
});
</script>

<style scoped>
.system-tab { display: flex; flex-direction: column; gap: 16px; }
.system-summary { cursor: pointer; display: flex; align-items: flex-start; gap: 10px; list-style: none; }
.system-summary::-webkit-details-marker { display: none; }
.system-summary-text { display: flex; flex-direction: column; gap: 4px; }
.system-summary-title { font-size: 16px; font-weight: 700; }
.system-chevron { flex: none; width: 8px; height: 8px; margin-top: 7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); transition: transform 0.15s; }
details[open] > .system-summary > .system-chevron { transform: rotate(45deg); }
.system-tools-body { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
</style>
