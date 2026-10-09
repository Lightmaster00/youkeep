<template>
  <div class="album-match-panel" data-testid="album-match-panel">
    <h4 class="results-header">Match albums</h4>
    <p class="section-desc">
      Looks up each downloaded track on the iTunes Search API to find its real album, cover, release year and track number.
      Only empty fields are filled. Tracks you edited, and tracks that came with an album from YouTube, are never changed.
    </p>
    <p class="section-desc" data-testid="album-match-privacy">
      Privacy: the artist name and title of each track are sent to Apple's public iTunes Search API, one track every few seconds.
      Turn matching off to stop this; new downloads are then not matched either.
    </p>

    <label class="album-match-toggle">
      <input
        type="checkbox"
        data-testid="album-match-enabled"
        :checked="enabled"
        :disabled="savingSetting || preview === null"
        @change="toggleEnabled"
      />
      <span>Match albums automatically ({{ enabled ? 'On' : 'Off' }})</span>
    </label>

    <p v-if="errorMessage" class="settings-error-msg" data-testid="album-match-error">{{ errorMessage }}</p>

    <div v-if="status && status.state === 'running'" class="album-match-progress" data-testid="album-match-progress">
      <div class="album-match-bar" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
        <div class="album-match-bar-fill" :style="{ transform: `scaleX(${progressPercent / 100})` }"></div>
      </div>
      <p class="section-desc">{{ status.processed }} of {{ status.total }} tracks checked, {{ status.matched }} matched.</p>
      <button type="button" class="btn btn-secondary-dark" :disabled="cancelling" data-testid="album-match-cancel" @click="cancelRun">
        {{ cancelling ? 'Cancelling...' : 'Cancel' }}
      </button>
    </div>

    <div v-else-if="report" class="album-match-report" data-testid="album-match-report">
      <p :class="report.state === 'done' && report.errors === 0 ? 'settings-success-msg' : 'settings-error-msg'">{{ reportTitle }}</p>
      <p class="section-desc">{{ report.matched }} matched, {{ report.unmatched }} without a match, {{ report.errors }} failed.</p>
      <p v-if="report.lastError && report.state !== 'done'" class="settings-error-msg">{{ report.lastError }}</p>
      <button type="button" class="btn btn-secondary-dark" data-testid="album-match-done" @click="closeReport">Done</button>
    </div>

    <template v-else>
      <p v-if="preview" class="section-desc" data-testid="album-match-counts">
        {{ preview.completedTracks }} downloaded track(s): {{ preview.unchecked }} not checked yet, {{ preview.matched }} matched,
        {{ preview.unmatched }} without a match, {{ preview.manual }} set by hand or by YouTube.
      </p>
      <div class="album-match-actions">
        <button type="button" class="btn btn-primary" :disabled="!canStartUnchecked" data-testid="album-match-start" @click="startRun('unchecked')">
          {{ starting ? 'Starting...' : 'Match unchecked tracks' }}
        </button>
        <button type="button" class="btn btn-secondary-dark" :disabled="!canRetryUnmatched" data-testid="album-match-retry" @click="startRun('unmatched')">
          Retry tracks without a match
        </button>
        <button type="button" class="btn btn-secondary-dark" :disabled="loadingPreview" data-testid="album-match-refresh" @click="loadPreview">
          {{ loadingPreview ? 'Checking...' : 'Refresh counts' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface AlbumMatchPreview {
  completedTracks: number; unchecked: number; matched: number; unmatched: number; manual: number; enabled: boolean;
}
interface AlbumMatchStatus {
  state: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
  processed: number; total: number; matched: number; unmatched: number; errors: number;
  lastError: string | null;
}

/** Consecutive 401/403 answers after which polling stops (the session is gone). */
const AUTH_FAILURE_LIMIT = 3;
const BASE = '/api/admin/music/album-match';

const preview = ref<AlbumMatchPreview | null>(null);
const status = ref<AlbumMatchStatus | null>(null);
const report = ref<AlbumMatchStatus | null>(null);
const loadingPreview = ref(false);
const starting = ref(false);
const cancelling = ref(false);
const savingSetting = ref(false);
const errorMessage = ref('');
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let authFailures = 0;
let unmounted = false;

const enabled = computed(() => preview.value?.enabled ?? false);
const canStartUnchecked = computed(() => !!preview.value && enabled.value && preview.value.unchecked > 0 && !starting.value);
const canRetryUnmatched = computed(() => !!preview.value && enabled.value && preview.value.unmatched > 0 && !starting.value);
const progressPercent = computed(() => {
  const s = status.value;
  return s && s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
});
const reportTitle = computed(() => {
  const r = report.value;
  if (!r) return '';
  if (r.state === 'cancelled') return 'Album matching was stopped. Start it again to check the remaining tracks.';
  if (r.state === 'failed') return 'Album matching stopped because of an error.';
  return r.errors > 0 ? 'Album matching finished with errors.' : 'Album matching finished.';
});

function messageOf(err: any, fallback: string): string {
  return err?.data?.statusMessage || fallback;
}

function schedulePoll() {
  if (unmounted) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollStatus, 1000);
}

async function loadPreview() {
  if (loadingPreview.value) return;
  loadingPreview.value = true;
  try {
    preview.value = await $fetch<AlbumMatchPreview>(`${BASE}/preview`, { method: 'POST' });
  } catch (err) {
    errorMessage.value = messageOf(err, 'Could not count the tracks.');
  } finally {
    loadingPreview.value = false;
  }
}

async function pollStatus() {
  pollTimer = null;
  try {
    const s = await $fetch<AlbumMatchStatus>(`${BASE}/status`);
    authFailures = 0;
    if (s?.state === 'running') {
      status.value = s;
      schedulePoll();
      return;
    }
    status.value = null;
    cancelling.value = false;
    if (s && (s.state === 'done' || s.state === 'failed' || s.state === 'cancelled')) report.value = s;
  } catch (err: any) {
    const code = err?.statusCode ?? err?.status ?? err?.response?.status;
    if (code === 401 || code === 403) {
      authFailures++;
      if (authFailures >= AUTH_FAILURE_LIMIT) {
        status.value = null;
        errorMessage.value = 'You are no longer signed in as an administrator. Reload the page to follow album matching.';
        return;
      }
    }
    // A single failed request must not freeze the progress view.
    schedulePoll();
  }
}

async function startRun(scope: 'unchecked' | 'unmatched') {
  if (scope === 'unchecked' ? !canStartUnchecked.value : !canRetryUnmatched.value) return;
  starting.value = true;
  errorMessage.value = '';
  try {
    await $fetch(`${BASE}/start`, { method: 'POST', body: { scope } });
  } catch (err) {
    errorMessage.value = messageOf(err, 'Could not start album matching.');
    starting.value = false;
    return;
  }
  starting.value = false;
  await pollStatus();
}

async function cancelRun() {
  if (cancelling.value) return;
  cancelling.value = true;
  try {
    await $fetch(`${BASE}/cancel`, { method: 'POST' });
  } catch (err) {
    cancelling.value = false;
    errorMessage.value = messageOf(err, 'Could not stop album matching.');
  }
}

async function toggleEnabled(event: Event) {
  const input = event.target as HTMLInputElement;
  const wanted = input.checked;
  savingSetting.value = true;
  errorMessage.value = '';
  try {
    const result = await $fetch<{ enabled: boolean }>(`${BASE}/settings`, { method: 'POST', body: { enabled: wanted } });
    if (preview.value) preview.value = { ...preview.value, enabled: result.enabled };
    // Turning it off stops a running run: follow it to its end.
    if (!result.enabled && status.value) schedulePoll();
  } catch (err) {
    input.checked = enabled.value;
    errorMessage.value = messageOf(err, 'Could not save the setting.');
  } finally {
    savingSetting.value = false;
  }
}

function closeReport() {
  report.value = null;
  loadPreview();
}

onMounted(async () => {
  await loadPreview();
  try {
    const s = await $fetch<AlbumMatchStatus>(`${BASE}/status`);
    if (!unmounted && s?.state === 'running') {
      status.value = s;
      schedulePoll();
    }
  } catch {
    // The panel still works from the counts.
  }
});

onUnmounted(() => {
  unmounted = true;
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<style scoped>
.album-match-panel { display: flex; flex-direction: column; gap: 10px; }
.album-match-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.album-match-toggle { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.album-match-bar { width: 100%; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.album-match-bar-fill { width: 100%; height: 100%; background: var(--accent-primary); transform-origin: left; transition: transform 0.3s; }
</style>
