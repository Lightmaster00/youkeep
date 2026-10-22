<template>
  <div class="auto-sync-card" :class="{ 'glass-panel': !compact, compact }" data-testid="auto-sync">
    <h3 v-if="!compact" class="auto-sync-title">Automatic sync</h3>
    <p v-if="!compact" class="section-desc">Followed channels, artists and shows are checked for new items on a schedule (change it under Advanced).</p>
    <p v-if="loadFailed" class="section-desc" data-testid="auto-sync-error">Could not load the sync status.</p>
    <ul v-else-if="status" class="auto-sync-list">
      <li v-for="kind in kinds" :key="kind" :data-testid="`auto-sync-${kind}`">
        <div class="auto-sync-row">
          <span class="auto-sync-label">{{ KIND_LABELS[kind] }}</span>
          <span class="auto-sync-line" :data-testid="`auto-sync-${kind}-line`">{{ syncLine(status[kind], now) }}</span>
          <button
            v-if="!compact"
            type="button"
            class="btn btn-secondary-dark btn-sm"
            :disabled="syncing[kind] || status[kind].running"
            :data-testid="`auto-sync-${kind}-now`"
            @click="syncNow(kind)"
          >{{ syncing[kind] || status[kind].running ? 'Syncing...' : 'Sync now' }}</button>
        </div>
        <p v-if="stuckNotice(status[kind], now)" class="auto-sync-stuck" role="alert" :data-testid="`auto-sync-${kind}-stuck`">
          {{ stuckNotice(status[kind], now) }}
        </p>
      </li>
    </ul>
    <p v-else class="section-desc">Loading...</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useToast } from '~/composables/useToast';
import { useModules } from '~/composables/useModules';
import { DOWNLOAD_KINDS, KIND_API_BASE, KIND_LABELS, type DownloadKind } from '~/utils/allDownloads';
import { isSyncStatus, stuckNotice, syncLine, type SyncStatus } from '~/utils/syncStatus';

// Last and next automatic sync per library, a stuck warning, and "Sync now"
// (the existing sync-all routes). `compact`: one line per type (Overview).
defineProps<{ compact?: boolean }>();

const toast = useToast();
const { isEnabled } = useModules();
const MODULE_OF: Record<DownloadKind, string> = { video: 'video', music: 'music', podcast: 'podcasts' };
const kinds = computed(() => DOWNLOAD_KINDS.filter((k) => isEnabled(MODULE_OF[k])));

const status = ref<SyncStatus | null>(null);
const loadFailed = ref(false);
const now = ref(Date.now());
const syncing = reactive<Record<DownloadKind, boolean>>({ video: false, music: false, podcast: false });

async function load() {
  try {
    const data = await $fetch<unknown>('/api/admin/sync-status');
    now.value = Date.now();
    if (isSyncStatus(data)) {
      status.value = data;
      loadFailed.value = false;
    } else {
      loadFailed.value = true;
    }
  } catch {
    loadFailed.value = true;
  }
}

async function syncNow(kind: DownloadKind) {
  if (syncing[kind]) return;
  syncing[kind] = true;
  try {
    const res = await $fetch<{ success?: boolean; message?: string }>(`${KIND_API_BASE[kind]}/sync-all`, { method: 'POST' });
    if (res?.success === false) toast.info(res.message || 'A sync is already running.');
    else toast.success(res?.message || `${KIND_LABELS[kind]}: sync started.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not start the sync.');
  } finally {
    syncing[kind] = false;
    await load();
  }
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.auto-sync-card { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.auto-sync-card:not(.compact) { padding: 16px; }
.auto-sync-title { margin: 0; font-size: 16px; font-weight: 700; }
.auto-sync-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--text-secondary); }
.auto-sync-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.auto-sync-label { font-weight: 600; color: var(--text-primary, inherit); min-width: 72px; }
.auto-sync-line { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.auto-sync-stuck {
  margin: 6px 0 0;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.15);
  color: #fecaca;
  font-weight: 600;
}
</style>
