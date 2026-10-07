<template>
  <div class="tidy-panel" data-testid="tidy-panel">
    <h4 class="results-header">Tidy library files</h4>
    <p class="section-desc">
      Moves each downloaded video into its own folder named after its title, together with its thumbnail, subtitles and metadata files.
      Partial files of unfinished downloads go into their video's folder too, so those downloads resume where they stopped.
      Nothing moves until you start it, and you can run it again to finish whatever is left.
    </p>

    <p v-if="errorMessage" class="settings-error-msg" data-testid="tidy-error">{{ errorMessage }}</p>

    <div v-if="status && status.state === 'running'" class="tidy-progress" data-testid="tidy-progress">
      <div class="tidy-bar" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
        <div class="tidy-bar-fill" :style="{ width: `${progressPercent}%` }"></div>
      </div>
      <p v-if="status.total === 0" class="section-desc">Preparing...</p>
      <p v-else class="section-desc">{{ status.processed }} of {{ status.total }} videos processed, {{ status.moved }} moved.</p>
      <button type="button" class="btn btn-secondary-dark" :disabled="cancelling" data-testid="tidy-cancel" @click="cancelRun">
        {{ cancelling ? 'Cancelling...' : 'Cancel' }}
      </button>
    </div>

    <div v-else-if="report" class="tidy-report" data-testid="tidy-report">
      <p :class="report.state === 'done' && report.errors === 0 ? 'settings-success-msg' : 'settings-error-msg'">{{ reportTitle }}</p>
      <p class="section-desc">
        {{ report.moved }} moved, {{ report.skipped }} skipped, {{ report.errors }} failed<span v-if="report.channelsFixed">, {{ report.channelsFixed }} channel folder(s) repaired</span>.
      </p>
      <p v-if="report.state === 'failed' && report.lastError" class="settings-error-msg">{{ report.lastError }}</p>
      <ul v-if="report.errorDetails.length" class="tidy-list">
        <li v-for="item in report.errorDetails" :key="item.id">"{{ item.title }}": {{ item.message }}</li>
      </ul>
      <ul v-if="report.channelProblems?.length" class="tidy-list" data-testid="tidy-channel-problems">
        <li v-for="item in report.channelProblems" :key="item.channelId">{{ item.channel }}: {{ item.message }}</li>
      </ul>
      <p v-if="report.nextStep" class="section-desc" data-testid="tidy-next-step">{{ report.nextStep }}</p>
      <button type="button" class="btn btn-secondary-dark" data-testid="tidy-done" @click="report = null">Done</button>
    </div>

    <template v-else>
      <div v-if="preview" class="tidy-preview" data-testid="tidy-preview">
        <p><strong>{{ preview.toMove }}</strong> of {{ preview.total }} video(s) will be moved. {{ preview.alreadyTidy }} already tidy.</p>
        <p v-if="preview.unfinishedToMove" class="section-desc" data-testid="tidy-unfinished">
          {{ preview.unfinishedToMove }} unfinished download(s): their {{ preview.unfinishedFiles }} partial file(s) will be moved into the video's folder so the download can resume.
        </p>
        <p v-if="hasProblems" class="section-desc">
          Left as they are: {{ preview.conflicts }} name conflict(s), {{ preview.missingFiles }} missing file(s),
          {{ preview.notWritable }} in folders YouKeep cannot write to.
        </p>
        <ul v-if="preview.problems?.length" class="tidy-list" data-testid="tidy-problems">
          <li v-for="item in preview.problems" :key="item.id">"{{ item.title }}": {{ item.reason }}</li>
        </ul>
        <p v-if="preview.duplicateFolders" class="section-desc">
          {{ preview.duplicateFolders }} channel(s) saved in a doubled folder (like "Channel/Channel") will be repaired.
        </p>
        <div v-if="preview.channelNotes?.length" data-testid="tidy-channel-notes">
          <p class="section-desc">These channels keep their save folder (their videos are still tidied inside it):</p>
          <ul class="tidy-list">
            <li v-for="note in preview.channelNotes" :key="note.channelId">{{ note.channel }}: {{ note.note }}</li>
          </ul>
        </div>
        <ul v-if="preview.samples.length" class="tidy-list">
          <li v-for="sample in preview.samples.slice(0, 10)" :key="sample.id"><code>{{ sample.from }}</code> &rarr; <code>{{ sample.to }}</code></li>
        </ul>
      </div>
      <div class="tidy-actions">
        <button type="button" class="btn btn-secondary-dark" :disabled="loadingPreview" data-testid="tidy-preview-btn" @click="loadPreview">
          {{ loadingPreview ? 'Checking...' : preview ? 'Check again' : 'Show what will change' }}
        </button>
        <button type="button" class="btn btn-primary" :disabled="!canStart" data-testid="tidy-start" @click="startRun">
          {{ starting ? 'Starting...' : 'Start tidying' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface TidyPreview {
  total: number; toMove: number; alreadyTidy: number; conflicts: number; missingFiles: number; notWritable: number; duplicateFolders: number;
  unfinishedToMove?: number; unfinishedFiles?: number;
  samples: { id: string; title: string; from: string; to: string }[];
  channels: { channelId: string; channel: string; toMove: number }[];
  channelNotes?: { channelId: string; channel: string; note: string }[];
  problems?: { id: string; title: string; reason: string }[];
}
interface TidyStatus {
  state: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
  processed: number; total: number; moved: number; skipped: number; errors: number;
  lastError: string | null;
  errorDetails: { id: string; title: string; message: string }[];
  channelsFixed: number;
  channelProblems?: { channelId: string; channel: string; message: string }[];
  nextStep?: string | null;
}

/** Consecutive 401/403 answers after which polling stops (the session is gone). */
const AUTH_FAILURE_LIMIT = 3;

const preview = ref<TidyPreview | null>(null);
const status = ref<TidyStatus | null>(null);
const report = ref<TidyStatus | null>(null);
const loadingPreview = ref(false);
const starting = ref(false);
const cancelling = ref(false);
const errorMessage = ref('');
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let authFailures = 0;
let unmounted = false;

function schedulePoll() {
  if (unmounted) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollStatus, 1000);
}

const canStart = computed(() => !!preview.value && !loadingPreview.value && (preview.value.toMove > 0 || preview.value.duplicateFolders > 0 || (preview.value.unfinishedToMove ?? 0) > 0) && !starting.value);
const hasProblems = computed(() => !!preview.value && preview.value.conflicts + preview.value.missingFiles + preview.value.notWritable > 0);
const progressPercent = computed(() => {
  const s = status.value;
  return s && s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
});
const reportTitle = computed(() => {
  const r = report.value;
  if (!r) return '';
  if (r.state === 'cancelled') return 'Tidying was cancelled. Run it again to finish the rest.';
  if (r.state === 'failed') return 'Tidying stopped because of an error.';
  return r.errors > 0 ? 'Tidying finished with errors.' : 'Tidying finished.';
});

function messageOf(err: any, fallback: string): string {
  return err?.data?.statusMessage || fallback;
}

async function loadPreview() {
  if (loadingPreview.value) return;
  loadingPreview.value = true;
  errorMessage.value = '';
  try {
    preview.value = await $fetch<TidyPreview>('/api/admin/library/tidy/preview', { method: 'POST' });
  } catch (err) {
    preview.value = null;
    errorMessage.value = messageOf(err, 'Could not check the library files.');
  } finally {
    loadingPreview.value = false;
  }
}

async function pollStatus() {
  pollTimer = null;
  try {
    const s = await $fetch<TidyStatus>('/api/admin/library/tidy/status');
    authFailures = 0;
    if (s?.state === 'running') {
      status.value = s;
      errorMessage.value = ''; // e.g. the "already running" refusal: the progress now explains it
      schedulePoll();
      return;
    }
    status.value = null;
    cancelling.value = false;
    if (s && (s.state === 'done' || s.state === 'failed' || s.state === 'cancelled')) {
      report.value = s;
      preview.value = null; // stale once files have moved
    }
  } catch (err: any) {
    const code = err?.statusCode ?? err?.status ?? err?.response?.status;
    if (code === 401 || code === 403) {
      authFailures++;
      if (authFailures >= AUTH_FAILURE_LIMIT) {
        status.value = null;
        errorMessage.value = 'You are no longer signed in as an administrator. Reload the page to follow the tidying.';
        return;
      }
    }
    // A single failed request must not freeze the progress view.
    schedulePoll();
  }
}

async function startRun() {
  if (!canStart.value) return;
  if (!confirm('Move the video files now? Each video goes into its own folder. You can cancel at any time.')) return;
  starting.value = true;
  errorMessage.value = '';
  try {
    await $fetch('/api/admin/library/tidy/start', { method: 'POST' });
  } catch (err) {
    errorMessage.value = messageOf(err, 'Could not start tidying.');
    starting.value = false;
    await pollStatus(); // a run already in progress (409) is picked up and shown
    return;
  }
  starting.value = false;
  await pollStatus();
}

async function cancelRun() {
  if (cancelling.value) return;
  cancelling.value = true;
  try {
    await $fetch('/api/admin/library/tidy/cancel', { method: 'POST' });
  } catch (err) {
    cancelling.value = false;
    errorMessage.value = messageOf(err, 'Could not cancel tidying.');
  }
}

onMounted(async () => {
  try {
    const s = await $fetch<TidyStatus>('/api/admin/library/tidy/status');
    if (!unmounted && s?.state === 'running') {
      status.value = s;
      schedulePoll();
    }
  } catch {
    // The panel still works from a fresh preview.
  }
});

onUnmounted(() => {
  unmounted = true;
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<style scoped>
.tidy-panel { display: flex; flex-direction: column; gap: 10px; }
.tidy-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.tidy-bar { width: 100%; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.tidy-bar-fill { height: 100%; background: var(--accent-primary); transition: width 0.3s; }
.tidy-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; overflow-wrap: anywhere; }
.tidy-list code { word-break: break-all; }
</style>
