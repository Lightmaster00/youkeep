<template>
  <div class="tab-pane downloads-hub">
    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Downloads</h2>
        <p>Everything that is queued, downloading or failed, for videos, music and podcasts.</p>
      </div>
    </div>

    <div class="download-type-cards">
      <DownloadTypeCard v-for="kind in DOWNLOAD_KINDS" :key="kind" :kind="kind" :state="states[kind]" @changed="refreshAll" />
    </div>

    <div class="queue-box glass-panel">
      <div class="queue-filter" role="group" aria-label="Filter the queue">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          class="queue-filter-btn"
          :class="{ active: filter === f.key }"
          :aria-pressed="filter === f.key"
          :data-testid="`filter-${f.key}`"
          @click="filter = f.key"
        >{{ f.label }} <span class="queue-filter-count">{{ counts[f.key] }}</span></button>
      </div>

      <p v-if="notice" class="queue-truncated-notice" data-testid="queue-cap-notice">{{ notice }}</p>

      <DownloadQueueList :items="visible.items" :progress-for="progressFor" @action="onQueueAction" />
    </div>

    <DownloadsAdvanced />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import DownloadTypeCard from '~/components/settings/DownloadTypeCard.vue';
import DownloadQueueList from '~/components/settings/DownloadQueueList.vue';
import DownloadsAdvanced from '~/components/settings/DownloadsAdvanced.vue';
import { useAllDownloads } from '~/composables/useAllDownloads';
import { useToast } from '~/composables/useToast';
import { DOWNLOAD_KINDS, FILTERS, queueActionRequest, type QueueAction, type QueueItem } from '~/utils/allDownloads';

const toast = useToast();
const { filter, states, counts, visible, notice, progressFor, refreshAll, startPolling, stopPolling } = useAllDownloads();

const ACTION_DONE: Record<QueueAction, string> = {
  prioritize: 'Moved to the front of the queue.',
  cancel: 'Download cancelled.',
  retry: 'Queued again.',
};

async function onQueueAction(item: QueueItem, action: QueueAction) {
  try {
    const request = queueActionRequest(item, action);
    await $fetch(request.url, { method: 'POST', ...(request.body ? { body: request.body } : {}) });
    toast.success(ACTION_DONE[action]);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'That action failed.');
  } finally {
    await refreshAll();
  }
}

onMounted(startPolling);
onUnmounted(stopPolling);
</script>

<style scoped>
.download-type-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 16px; }
.queue-box { padding: 16px; }
.queue-filter { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.queue-filter-btn { border: 1px solid rgba(255, 255, 255, 0.12); background: transparent; color: inherit; border-radius: 999px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.queue-filter-btn.active { background: rgba(139, 92, 246, 0.25); border-color: rgba(139, 92, 246, 0.6); }
.queue-filter-count { opacity: 0.7; margin-left: 4px; }
.queue-truncated-notice { margin: 0 0 10px; font-size: 12px; color: var(--text-secondary); }
</style>
