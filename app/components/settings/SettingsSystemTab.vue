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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
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
</script>
