<template>
  <div class="queue-card-premium" :data-testid="`queue-item-${item.kind}-${item.id}`">
    <div class="queue-card-details">
      <div class="queue-card-meta-main">
        <span class="type-pill" :class="`type-pill-${item.kind}`">{{ KIND_PILL[item.kind] }}</span>
        <h4 class="queue-card-title" :title="item.title">{{ item.title }}</h4>
        <span class="queue-card-channel-name">{{ item.source }}</span>
      </div>
      <span class="status-badge" :class="`status-${item.status}`" data-testid="queue-item-status">{{ STATUS_LABELS[item.status] }}</span>
    </div>

    <div class="queue-progress-container">
      <div class="progress-bar-glow-bg">
        <div class="progress-bar-glow-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <span class="progress-percent-text">{{ Math.round(progress) }}%</span>
    </div>

    <div v-if="item.status === 'downloading'" class="queue-diagnostics-row">
      <span v-if="item.speed" class="diag-meta-spec">Speed: {{ item.speed }}</span>
      <span v-if="item.eta" class="diag-meta-spec">ETA: {{ item.eta }}</span>
    </div>

    <div v-if="item.status === 'failed' && item.lastError" class="queue-error-box">
      <strong>Error:</strong> {{ item.lastError }}
    </div>

    <div v-if="actions.length > 0" class="queue-card-action-bar">
      <button
        v-for="action in actions"
        :key="action"
        type="button"
        class="btn-action-premium"
        :class="{ 'btn-action-danger': action === 'cancel' }"
        :data-testid="`queue-action-${action}`"
        @click="$emit('action', action)"
      >{{ ACTION_LABELS[action] }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { KIND_PILL, STATUS_LABELS, ACTION_LABELS, queueActionsFor, type QueueItem, type QueueAction } from '~/utils/allDownloads';

const props = defineProps<{ item: QueueItem; progress: number }>();
defineEmits<{ action: [QueueAction] }>();

const actions = computed(() => queueActionsFor(props.item));
</script>

<style scoped>
.type-pill { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 6px; margin-bottom: 4px; background: rgba(255, 255, 255, 0.08); }
.type-pill-video { color: #c4b5fd; }
.type-pill-music { color: #93c5fd; }
.type-pill-podcast { color: #86efac; }
</style>
