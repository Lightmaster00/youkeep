<template>
  <div class="tab-pane">
    <div class="system-dashboard-layout">
      <!-- Left Column: Diagnostic & Tools (40% width) -->
      <div class="system-diagnostic-col">
        <div class="config-section glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-pink">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            </div>
            <div>
              <h3>Engine Binaries</h3>
              <p class="section-desc">Verify background yt-dlp/ffmpeg local processes operational status.</p>
            </div>
          </div>

          <div class="binary-path-box mt-3">
            <span class="path-label">Server yt-dlp path :</span>
            <code class="path-code">{{ diagnosticYtdlPath || 'resolving path...' }}</code>
          </div>

          <div class="btn-group mt-3" style="width: 100%; display: flex; gap: 10px;">
            <button @click="handleTestBinary" class="btn btn-secondary-dark flex-1" :disabled="diagnosticBinaryTesting">
              {{ diagnosticBinaryTesting ? 'Testing...' : 'Diagnostic Check' }}
            </button>

            <button @click="handleUpdateYtdl" class="btn btn-secondary-dark flex-1" :disabled="updatingYtdl">
              {{ updatingYtdl ? 'Updating...' : 'Update yt-dlp' }}
            </button>
          </div>

          <!-- Diagnostics results panel -->
          <div v-if="diagnosticBinaryResult" class="test-result-box mt-3 border-t pt-3">
            <div class="diagnostic-status-item">
              <span class="diagnostic-label">yt-dlp Engine Status:</span>
              <span :class="diagnosticBinaryResult.success ? 'badge-status badge-success' : 'badge-status badge-danger'">
                {{ diagnosticBinaryResult.success ? 'Operational' : 'Error' }}
              </span>
              <div v-if="diagnosticBinaryResult.success" class="diagnostic-version-sub mt-1">
                Version: <code>{{ diagnosticBinaryResult.version }}</code>
              </div>
            </div>

            <div class="diagnostic-status-item mt-3">
              <span class="diagnostic-label">FFmpeg Merging status:</span>
              <span :class="diagnosticBinaryResult.ffmpegAvailable ? 'badge-status badge-success' : 'badge-status badge-warning'">
                {{ diagnosticBinaryResult.ffmpegAvailable ? 'AV Merge active' : 'Not detected' }}
              </span>
            </div>

            <div v-if="!diagnosticBinaryResult.ffmpegAvailable" class="ffmpeg-warning-box mt-3">
              <strong class="warning-title">💡 Standard Formats only (720p max):</strong>
              <p class="warning-desc">FFmpeg was not detected in system execution paths. Thumbnails cannot be converted to JPG, and downloads will be capped at combined formats. Install <code>ffmpeg</code> on the host system to enable high-quality (1080p, 4K) downloads.</p>
            </div>

            <div v-if="diagnosticBinaryResult.stderr" class="diagnostic-stderr-box mt-3">
              <h5>stderr capture:</h5>
              <pre class="diagnostic-pre mt-1">{{ diagnosticBinaryResult.stderr }}</pre>
            </div>
          </div>

          <div v-if="updatingYtdl || updateConsoleOutput" class="test-result-box mt-3 border-t pt-3">
            <h4>Worker output log:</h4>
            <pre class="diagnostic-pre mt-2">{{ updateConsoleOutput || 'Executing path binaries update...' }}</pre>
          </div>
        </div>
      </div>

      <!-- Right Column: Interactive terminal logs (60% width) -->
      <div class="system-logs-col">
        <div class="logs-container glass-panel">
          <div class="logs-header">
            <div class="flex-align-center gap-10">
              <span class="terminal-dot green"></span>
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: white;">System Ingestion Logs</h3>
            </div>
            <button @click="fetchDiagnostics" class="btn btn-secondary-dark btn-icon-sm" title="Refresh logs">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            </button>
          </div>
          <div class="logs-terminal" ref="terminalBody">
            <div v-if="diagnosticLogs.length === 0" class="log-line text-muted">
              No log buffer entries captured.
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

      <div class="config-section glass-panel danger-zone-panel">
        <div class="section-title-row">
          <div class="icon-orb bg-pink">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </div>
          <div>
            <h3>Danger Zone</h3>
            <p class="section-desc">Permanently delete every video, music track, and podcast episode — files and database records — across the whole archive. This cannot be undone.</p>
          </div>
        </div>

        <div v-if="!wipePreview" class="mt-3">
          <button @click="loadWipePreview" class="btn btn-secondary-dark" :disabled="loadingWipePreview">
            {{ loadingWipePreview ? 'Loading...' : 'Show what will be deleted' }}
          </button>
        </div>

        <div v-else-if="!wipeInProgress && !wipeReport" class="mt-3 danger-zone-preview">
          <p class="danger-zone-summary">
            This will permanently delete
            <strong>{{ wipePreview.channelCount }}</strong> channel(s) ({{ wipePreview.videoCount }} video(s)),
            <strong>{{ wipePreview.artistCount }}</strong> artist(s) ({{ wipePreview.trackCount }} track(s)), and
            <strong>{{ wipePreview.showCount }}</strong> show(s) ({{ wipePreview.episodeCount }} episode(s)) —
            an estimated <strong>{{ formatBytes(wipePreview.estimatedBytes) }}</strong> of files.
          </p>
          <p class="danger-zone-hint">Type <code>SUPPRIMER</code> below to enable the button.</p>
          <input
            v-model="wipeConfirmText"
            type="text"
            class="form-input mt-2"
            placeholder="SUPPRIMER"
            :disabled="startingWipe"
          />
          <button
            @click="handleStartWipe"
            class="btn btn-danger mt-3"
            :disabled="wipeConfirmText !== 'SUPPRIMER' || startingWipe"
          >
            {{ startingWipe ? 'Starting...' : 'Wipe everything' }}
          </button>
        </div>

        <div v-else-if="wipeInProgress" class="mt-3 danger-zone-progress">
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
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';

const toast = useToast();
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
    toast.success('Binary test completed.');
  } catch (err: any) {
    diagnosticBinaryResult.value = {
      success: false,
      stderr: err.data?.statusMessage || err.message || 'Unknown error'
    };
    toast.error('Binary test failed.');
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
  if (wipeConfirmText.value !== 'SUPPRIMER') return;
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
      wipePreview.value = null;
      return;
    }
  } catch (e) {
    // Keep polling even on a transient fetch error — matches this app's
    // existing queue-polling resilience (runPolling in settings.vue never
    // stops on a single failed fetch either).
  }
  wipePollTimeout = setTimeout(pollWipeStatus, 1000);
}

onUnmounted(() => {
  if (wipePollTimeout) clearTimeout(wipePollTimeout);
});

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
</script>
