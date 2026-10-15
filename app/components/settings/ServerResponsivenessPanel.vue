<template>
  <div class="responsiveness-panel" data-testid="responsiveness-panel">
    <h4 class="results-header">Server responsiveness</h4>
    <p v-if="errorMessage" class="settings-error-msg" data-testid="responsiveness-error">{{ errorMessage }}</p>
    <div v-else-if="perf" class="responsiveness-row">
      <span :class="['badge-status', badgeClass]" data-testid="responsiveness-level">{{ levelLabel }}</span>
      <span class="section-desc responsiveness-numbers" data-testid="responsiveness-numbers">
        Last 15 minutes: longest pause {{ formatMs(perf.last15min.maxMs) }}, p99 {{ formatMs(perf.last15min.p99Ms) }},
        {{ perf.last15min.stalls === 1 ? '1 stall' : `${perf.last15min.stalls} stalls` }}.
        Now: {{ formatMs(perf.current.maxMs) }}.
        {{ perf.activeDownloads === 1 ? '1 download running.' : `${perf.activeDownloads} downloads running.` }}
      </span>
      <button type="button" class="btn btn-secondary-dark btn-icon-sm" :disabled="loading" title="Refresh" data-testid="responsiveness-refresh" @click="load">
        {{ loading ? 'Checking...' : 'Refresh' }}
      </button>
    </div>
    <p v-else class="section-desc">Checking...</p>
    <p class="section-desc">Stalls while downloading usually mean the data folder is on a slow disk — keep appdata on an SSD/cache drive.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

// One-line readout of the server's event-loop delay (server/utils/loopMonitor.ts):
// green under 100 ms, amber under 500 ms, red from 500 ms (longest pause of the
// last 15 minutes).
interface PerfSummary {
  current: { maxMs: number; p99Ms: number };
  last15min: { maxMs: number; p99Ms: number; stalls: number };
  activeDownloads: number;
}

const perf = ref<PerfSummary | null>(null);
const loading = ref(false);
const errorMessage = ref('');

const level = computed<'good' | 'slow' | 'stalling'>(() => {
  const max = perf.value?.last15min.maxMs ?? 0;
  if (max < 100) return 'good';
  if (max < 500) return 'slow';
  return 'stalling';
});
const levelLabel = computed(() => ({ good: 'Responsive', slow: 'Slow at times', stalling: 'Stalling' })[level.value]);
const badgeClass = computed(() => ({ good: 'badge-success', slow: 'badge-warning', stalling: 'badge-danger' })[level.value]);

function formatMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

function isSummary(data: any): data is PerfSummary {
  return !!data && typeof data.current?.maxMs === 'number' && typeof data.last15min?.maxMs === 'number';
}

async function load() {
  if (loading.value) return;
  loading.value = true;
  try {
    const data = await $fetch<PerfSummary>('/api/admin/system/perf');
    if (isSummary(data)) {
      perf.value = { ...data, activeDownloads: Number(data.activeDownloads) || 0 };
      errorMessage.value = '';
    } else {
      errorMessage.value = 'Could not read the server responsiveness.';
    }
  } catch {
    errorMessage.value = 'Could not read the server responsiveness.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.responsiveness-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.responsiveness-numbers {
  flex: 1 1 240px;
  margin: 0;
}
</style>
