<template>
  <div v-if="items.length === 0" class="queue-empty-state" data-testid="queue-empty">
    <h4>Nothing is downloading</h4>
    <p>New items appear here as soon as something you follow has new content.</p>
  </div>
  <div v-else class="queue-list-premium" data-testid="queue-list">
    <DownloadQueueCard
      v-for="item in items"
      :key="`${item.kind}-${item.id}`"
      :item="item"
      :progress="progressFor(item)"
      @action="(action: QueueAction) => $emit('action', item, action)"
    />
  </div>
</template>

<script setup lang="ts">
import DownloadQueueCard from '~/components/settings/DownloadQueueCard.vue';
import type { QueueItem, QueueAction } from '~/utils/allDownloads';

defineProps<{ items: QueueItem[]; progressFor: (item: QueueItem) => number }>();
defineEmits<{ action: [QueueItem, QueueAction] }>();
</script>
