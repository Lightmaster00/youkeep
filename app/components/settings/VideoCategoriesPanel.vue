<template>
  <div class="video-categories-panel" data-testid="video-categories-panel">
    <h4 class="results-header">Video categories</h4>
    <p class="section-desc">
      Looks up the YouTube categories and tags of videos downloaded before YouKeep stored them, for the home recommendations.
      One video every few seconds, in the background; new downloads get them automatically.
    </p>

    <label class="video-categories-toggle">
      <input
        type="checkbox"
        data-testid="video-categories-enabled"
        :checked="enabled"
        :disabled="savingSetting || info === null"
        @change="toggleEnabled"
      />
      <span>Look up categories in the background ({{ enabled ? 'On' : 'Off' }})</span>
    </label>

    <p v-if="errorMessage" class="settings-error-msg" data-testid="video-categories-error">{{ errorMessage }}</p>

    <p v-if="info && typeof info.total === 'number'" class="section-desc" data-testid="video-categories-counts">
      {{ info.total }} video(s): {{ info.enriched }} with categories, {{ info.pending }} waiting.
    </p>
    <p v-if="statusText" class="section-desc" data-testid="video-categories-status">{{ statusText }}</p>

    <div class="video-categories-actions">
      <button type="button" class="btn btn-primary" :disabled="!canStart" data-testid="video-categories-start" @click="startRun">
        {{ starting ? 'Starting...' : running ? 'Running...' : 'Run now' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface BackfillRun {
  state: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
  processed: number; enriched: number; failed: number;
  waitingReason: string | null; lastError: string | null;
}
interface BackfillInfo { total: number; enriched: number; pending: number; enabled: boolean; run: BackfillRun }

/** Consecutive 401/403 answers after which polling stops (the session is gone). */
const AUTH_FAILURE_LIMIT = 3;
const POLL_MS = 2000;
const BASE = '/api/admin/system/metadata-backfill';

const info = ref<BackfillInfo | null>(null);
const starting = ref(false);
const savingSetting = ref(false);
const errorMessage = ref('');
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let authFailures = 0;
let unmounted = false;

const enabled = computed(() => info.value?.enabled ?? false);
const running = computed(() => info.value?.run?.state === 'running');
const canStart = computed(() => !!info.value && enabled.value && info.value.pending > 0 && !running.value && !starting.value);
const statusText = computed(() => {
  const run = info.value?.run;
  if (!run) return '';
  if (run.state === 'running') {
    if (run.waitingReason) return `Waiting: ${run.waitingReason}`;
    return `Running: ${run.processed} video(s) checked, ${run.enriched} updated.`;
  }
  if (run.state === 'done') return `Finished: ${run.enriched} video(s) updated, ${run.failed} skipped after errors.`;
  if (run.state === 'cancelled') return `Stopped after ${run.processed} video(s). Run it again to continue.`;
  if (run.state === 'failed') return `Stopped because of an error: ${run.lastError ?? 'unknown error'}`;
  return '';
});

function messageOf(err: any, fallback: string): string {
  return err?.data?.statusMessage || fallback;
}

function schedulePoll() {
  if (unmounted) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(loadStatus, POLL_MS);
}

async function loadStatus() {
  pollTimer = null;
  try {
    const next = await $fetch<BackfillInfo>(`${BASE}/status`);
    authFailures = 0;
    if (unmounted) return;
    info.value = next;
    if (next?.run?.state === 'running') schedulePoll();
  } catch (err: any) {
    const code = err?.statusCode ?? err?.status ?? err?.response?.status;
    if (code === 401 || code === 403) {
      authFailures++;
      if (authFailures >= AUTH_FAILURE_LIMIT) {
        errorMessage.value = 'You are no longer signed in as an administrator. Reload the page.';
        return;
      }
    }
    if (info.value?.run?.state === 'running') schedulePoll();
    else if (!info.value) errorMessage.value = messageOf(err, 'Could not read the video category counts.');
  }
}

async function startRun() {
  if (!canStart.value) return;
  starting.value = true;
  errorMessage.value = '';
  try {
    await $fetch(`${BASE}/start`, { method: 'POST' });
  } catch (err) {
    errorMessage.value = messageOf(err, 'Could not start the lookup.');
    starting.value = false;
    return;
  }
  starting.value = false;
  await loadStatus();
}

async function toggleEnabled(event: Event) {
  const input = event.target as HTMLInputElement;
  const wanted = input.checked;
  savingSetting.value = true;
  errorMessage.value = '';
  try {
    const result = await $fetch<{ enabled: boolean }>(`${BASE}/settings`, { method: 'POST', body: { enabled: wanted } });
    if (info.value) info.value = { ...info.value, enabled: result.enabled };
    // Turning it off stops a running run: follow it to its end.
    if (!result.enabled && running.value) schedulePoll();
  } catch (err) {
    input.checked = enabled.value;
    errorMessage.value = messageOf(err, 'Could not save the setting.');
  } finally {
    savingSetting.value = false;
  }
}

onMounted(loadStatus);

onUnmounted(() => {
  unmounted = true;
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<style scoped>
.video-categories-panel { display: flex; flex-direction: column; gap: 10px; }
.video-categories-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.video-categories-toggle { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
</style>
