<template>
  <div class="reports-card glass-panel" data-testid="overview-reports">
    <div class="reports-head">
      <h3>Reports</h3>
      <span v-if="reports.length" class="reports-count">{{ reports.length }}</span>
    </div>
    <p v-if="loading && !loaded" class="section-desc">Loading...</p>
    <p v-else-if="error" class="reports-error" role="alert">{{ error }}</p>
    <p v-else-if="reports.length === 0" class="section-desc" data-testid="reports-empty">No video has been reported.</p>
    <ul v-else class="reports-list">
      <li v-for="r in reports" :key="r.id" class="reports-item" :data-testid="`report-${r.id}`">
        <div class="reports-item-main">
          <NuxtLink :to="`/watch/${encodeURIComponent(r.videoId)}`" class="reports-video">{{ r.videoTitle }}</NuxtLink>
          <span class="reports-meta">{{ r.channelTitle }} · {{ r.reporter || 'deleted user' }} · {{ formatDate(r.createdAt) }}</span>
          <p class="reports-reason">{{ r.reason }}</p>
        </div>
        <button type="button" class="btn btn-secondary-dark btn-sm" :disabled="dismissing === r.id" :aria-label="`Dismiss the report on ${r.videoTitle}`" @click="dismiss(r.id)">
          {{ dismissing === r.id ? 'Dismissing...' : 'Dismiss' }}
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
// Video reports sent by members (watch page → Report), for the admin.
import { ref, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';

interface Report { id: string; videoId: string; videoTitle: string; channelTitle: string; reporter: string | null; reason: string; createdAt: number }

const toast = useToast();
const reports = ref<Report[]>([]);
const loading = ref(false);
const loaded = ref(false);
const error = ref('');
const dismissing = ref('');

async function load() {
  loading.value = true;
  try {
    const data = await $fetch<{ reports: Report[] }>('/api/admin/reports');
    reports.value = data?.reports || [];
    error.value = '';
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Could not load the reports.';
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

async function dismiss(id: string) {
  dismissing.value = id;
  try {
    await $fetch(`/api/admin/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    reports.value = reports.value.filter((r) => r.id !== id);
    toast.success('Report dismissed.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not dismiss the report.');
  } finally {
    dismissing.value = '';
  }
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

onMounted(load);
</script>

<style scoped>
.reports-card { padding: 20px; display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.reports-head { display: flex; align-items: center; gap: 10px; }
.reports-head h3 { margin: 0; font-size: 18px; font-weight: 700; }
.reports-count { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: rgba(239, 68, 68, 0.15); color: #fca5a5; }
.reports-error { margin: 0; color: #f87171; font-size: 14px; }
.reports-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; max-height: 420px; overflow-y: auto; }
.reports-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.03); }
.reports-item-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.reports-video { font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
.reports-video:hover { text-decoration: underline; }
.reports-meta { font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; }
.reports-reason { margin: 4px 0 0; font-size: 13px; color: var(--text-secondary); overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
