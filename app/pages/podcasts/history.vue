<template>
  <div class="history-page">
    <div class="history-header">
      <h1 class="page-title history-title">{{ t('nav.history') }}</h1>
      <button
        v-if="user && items.length > 0"
        type="button"
        class="btn btn-danger-outline"
        @click="confirmingClear = true"
      >
        {{ t('podcasts.history.clear') }}
      </button>
    </div>

    <EmptyState
      v-if="!user"
      icon="music"
      :title="t('podcasts.history.loginTitle')"
      :description="t('podcasts.history.loginDesc')"
    />

    <template v-else>
      <EmptyState
        v-if="loaded && items.length === 0 && !hasMore && !error"
        icon="music"
        :title="t('podcasts.history.emptyTitle')"
        :description="t('podcasts.history.emptyDesc')"
      />
      <section v-for="day in days" :key="day.key" class="history-day" :aria-label="day.label">
        <h2 class="history-day-heading">{{ day.label }}</h2>
        <PodcastEpisodeRow
          v-for="ep in day.items"
          :key="ep.id"
          :episode="ep"
          :context="ep.show_title"
          :class="{ 'is-active': currentEpisode?.id === ep.id }"
          @play="playEpisode"
        >
          <template #actions>
            <button
              type="button"
              class="history-remove-btn"
              :aria-label="t('podcasts.history.removeLabel', { title: ep.title })"
              :title="t('podcasts.history.removeTitle')"
              @click.stop="remove(ep)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </template>
        </PodcastEpisodeRow>
      </section>

      <div v-if="loading" class="history-status">{{ t('common.loadingDots') }}</div>
      <div v-else-if="error" class="history-status">
        {{ t('podcasts.history.loadFailed') }}
        <button class="btn btn-secondary" @click="loadMore">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="hasMore" class="history-more">
        <button class="btn btn-secondary" @click="loadMore">{{ t('common.loadMore') }}</button>
      </div>
    </template>

    <ConfirmDialog
      :show="confirmingClear"
      :title="t('podcasts.history.clearTitle')"
      :message="t('podcasts.history.clearMessage')"
      :confirm-label="t('podcasts.history.clear')"
      :busy="clearing"
      @confirm="clearAll"
      @cancel="confirmingClear = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useHistoryList } from '~/composables/useHistoryList';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { usePodcastProgress } from '~/composables/usePodcastProgress';
import { toPlayableEpisode } from '~/utils/playableEpisode';

const { t } = useI18n();
useHead({ title: computed(() => t('podcasts.head.history')) });

// The logged-in user's started or played episodes, most recently listened
// first, grouped by day. Removing one also drops its resume position (the
// history is the progress itself).
const { user } = useAuth();
const { currentEpisode, play } = usePodcastPlayer();
const progressStore = usePodcastProgress();
const {
  items, days, loading, error, loaded, hasMore, loadMore, remove, confirmingClear, clearing, clearAll,
} = useHistoryList<any>('/api/podcasts/history', {
  timestampOf: (ep) => ep.progress?.updatedAt ?? 0,
  removeError: () => t('podcasts.history.removeFailed'),
  clearError: () => t('podcasts.history.clearFailed'),
  onRemove: (ep) => progressStore.record(ep.id, null),
  onRestore: (ep) => progressStore.record(ep.id, ep.progress ?? null),
  onClear: () => progressStore.forgetAll(),
});

// Progress comes with the list: no per-row lookups.
watch(() => items.value.length, () => {
  progressStore.seed(items.value.filter((ep) => !progressStore.isKnown(ep.id)));
});

function playEpisode(ep: any) {
  const playable = toPlayableEpisode(ep);
  if (playable) play(playable);
}

onMounted(() => {
  if (user.value) loadMore();
});
</script>

<style scoped>
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.history-title {
  margin: 0;
}

.history-day {
  margin-bottom: 24px;
}

.history-day-heading {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
}

.is-active :deep(.episode-title) {
  color: var(--accent-primary);
}

.history-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.history-remove-btn:hover {
  color: var(--accent-secondary);
  background: rgba(255, 255, 255, 0.06);
}

.history-remove-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.history-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.history-more {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
