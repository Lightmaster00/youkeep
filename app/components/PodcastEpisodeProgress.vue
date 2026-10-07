<template>
  <div v-if="progress" class="episode-progress" :class="{ played: progress.completed }">
    <span v-if="progress.completed" class="episode-progress-played">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
      Played
    </span>
    <div
      v-else
      class="episode-progress-track"
      role="progressbar"
      aria-label="Listened"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
    >
      <div class="episode-progress-fill" :style="{ width: `${percent}%` }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { usePodcastProgress } from '~/composables/usePodcastProgress';
import { progressFraction } from '#shared/podcastProgress';

// Thin "how much was heard" bar, or a "Played" mark, for one episode of the
// logged-in user. Renders nothing for never-started episodes and for guests.
const props = defineProps<{ episodeId: string; duration?: number | null }>();

const progressStore = usePodcastProgress();
const progress = computed(() => progressStore.get(props.episodeId));
const percent = computed(() => Math.round(progressFraction(progress.value, props.duration) * 100));

onMounted(() => progressStore.ensure([props.episodeId]));
watch(() => props.episodeId, (id) => progressStore.ensure([id]));
</script>

<style scoped>
.episode-progress {
  width: 100%;
  max-width: 220px;
  margin-top: 6px;
}

.episode-progress-track {
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.episode-progress-fill {
  height: 100%;
  background: var(--accent-primary);
}

.episode-progress-played {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
