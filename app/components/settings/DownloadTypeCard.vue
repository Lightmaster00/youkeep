<template>
  <div class="download-type-card glass-panel" :data-testid="`type-card-${kind}`">
    <div class="type-card-head">
      <h3>{{ KIND_LABELS[kind] }}</h3>
      <span :class="state.isPaused ? 'badge-paused-global' : 'badge-active-global'" data-testid="type-card-state">
        {{ state.isPaused ? 'Paused' : 'Active' }}
      </span>
    </div>

    <p v-if="state.error" class="settings-error-msg" data-testid="type-card-error">
      Couldn't load the {{ KIND_LABELS[kind].toLowerCase() }} queue. Retrying automatically.
    </p>
    <p class="section-desc" data-testid="type-card-summary">{{ summary.downloading }} downloading · {{ summary.queued }} queued</p>

    <div class="type-card-controls">
      <button type="button" class="btn" :class="state.isPaused ? 'btn-primary-glow' : 'btn-secondary-dark'" :disabled="toggling" data-testid="pause-toggle" @click="togglePause">
        {{ state.isPaused ? 'Resume' : 'Pause' }}
      </button>

      <div class="concurrency-control">
        <label :for="`concurrency-${kind}`" class="type-card-label">Simultaneous downloads</label>
        <input :id="`concurrency-${kind}`" v-model.number="concurrency" type="number" min="1" max="10" class="form-input type-card-number" data-testid="concurrency-input" />
        <button type="button" class="btn btn-secondary-dark btn-sm" :disabled="savingConcurrency" data-testid="concurrency-save" @click="saveConcurrency">
          {{ savingConcurrency ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>

    <div v-if="state.failedCount > 0" class="type-card-failed">
      <span>{{ state.failedCount }} failed</span>
      <button type="button" class="btn btn-secondary-dark btn-sm" :disabled="retrying" data-testid="retry-failed" @click="retryFailed">
        {{ retrying ? 'Retrying...' : 'Retry' }}
      </button>
    </div>

    <button v-if="kind === 'video' && state.total > 0" type="button" class="btn btn-danger-outline btn-clean btn-sm" data-testid="clear-queue" @click="clearQueue">
      Clear queue
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { KIND_LABELS, KIND_PILL, KIND_API_BASE, typeSummary, type DownloadKind, type TypeQueueState } from '~/utils/allDownloads';

const props = defineProps<{ kind: DownloadKind; state: TypeQueueState }>();
const emit = defineEmits<{ changed: [] }>();

const toast = useToast();
// Mirrors MAX_CONCURRENT_DOWNLOADS_CEILING in server/utils/concurrency.ts (server-only, not importable here).
const MAX_CONCURRENT = 10;

const base = KIND_API_BASE[props.kind];
const label = KIND_LABELS[props.kind];
const noun = KIND_PILL[props.kind];

const summary = computed(() => typeSummary(props.state));
const toggling = ref(false);
const concurrency = ref<number | string>(2);
const lastServerConcurrency = ref(2);
const savingConcurrency = ref(false);
const retrying = ref(false);
const clearing = ref(false);

async function fetchConcurrency() {
  try {
    const data = await $fetch<{ maxConcurrentDownloads?: number }>(`${base}/concurrency`);
    lastServerConcurrency.value = data?.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error(`Failed to fetch ${props.kind} concurrency:`, err);
  }
  // On a failed read this restores the last known good server value.
  concurrency.value = lastServerConcurrency.value;
}

async function saveConcurrency() {
  const v = concurrency.value;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_CONCURRENT) {
    toast.error(`Enter a whole number from 1 to ${MAX_CONCURRENT}.`);
    concurrency.value = lastServerConcurrency.value;
    return;
  }
  savingConcurrency.value = true;
  try {
    await $fetch(`${base}/concurrency`, { method: 'POST', body: { maxConcurrentDownloads: v } });
    toast.success(`${label}: simultaneous downloads saved.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the number of simultaneous downloads.');
  } finally {
    await fetchConcurrency();
    savingConcurrency.value = false;
  }
}

async function togglePause() {
  toggling.value = true;
  const resuming = props.state.isPaused;
  try {
    await $fetch(`${base}/${resuming ? 'resume' : 'pause'}`, { method: 'POST' });
    toast.success(resuming ? `${noun} downloads resumed.` : `${noun} downloads paused.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not change the download state.');
  } finally {
    toggling.value = false;
    emit('changed');
  }
}

async function retryFailed() {
  retrying.value = true;
  try {
    await $fetch(`${base}/retry-failed`, { method: 'POST' });
    toast.success('Failed downloads queued again.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Retry failed.');
  } finally {
    retrying.value = false;
    emit('changed');
  }
}

async function clearQueue() {
  if (clearing.value) return;
  if (!confirm('Remove every queued, downloading and failed video from the queue? Videos already downloaded are kept.')) return;
  clearing.value = true;
  try {
    await $fetch('/api/admin/downloader/clear-queue', { method: 'POST' });
    toast.success('Video queue cleared.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not clear the queue.');
  } finally {
    clearing.value = false;
    emit('changed');
  }
}

onMounted(fetchConcurrency);
</script>

<style scoped>
.download-type-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.type-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.type-card-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
.type-card-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.concurrency-control { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.type-card-label { font-size: 13px; color: var(--text-secondary); }
.type-card-number { width: 64px; }
.type-card-failed { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--text-secondary); font-size: 13px; }
</style>
