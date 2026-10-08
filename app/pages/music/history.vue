<template>
  <div class="history-page">
    <div class="history-header">
      <h1 class="page-title history-title">History</h1>
      <button
        v-if="user && items.length > 0"
        type="button"
        class="btn btn-danger-outline"
        @click="confirmingClear = true"
      >
        Clear history
      </button>
    </div>

    <EmptyState
      v-if="!user"
      icon="music"
      title="Log in to see your history"
      description="The songs you play are kept per account."
    />

    <template v-else>
      <EmptyState
        v-if="loaded && items.length === 0 && !hasMore && !error"
        icon="music"
        title="No listening history yet"
        description="Songs you play show up here."
      />
      <section v-for="day in days" :key="day.key" class="history-day" :aria-label="day.label">
        <h2 class="history-day-heading">{{ day.label }}</h2>
        <MusicTrackList
          :tracks="day.items"
          :active-id="currentTrack?.id"
          @play="(track) => playFrom(track, items)"
        >
          <template #actions="{ track }">
            <button
              type="button"
              class="history-remove-btn"
              :aria-label="`Remove ${track.title} from history`"
              title="Remove from history"
              @click="remove(track)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </template>
        </MusicTrackList>
      </section>

      <div v-if="loading" class="history-status">Loading...</div>
      <div v-else-if="error" class="history-status">
        Failed to load your history.
        <button class="btn btn-secondary" @click="loadMore">Retry</button>
      </div>
      <div v-else-if="hasMore" class="history-more">
        <button class="btn btn-secondary" @click="loadMore">Load more</button>
      </div>
    </template>

    <ConfirmDialog
      :show="confirmingClear"
      title="Clear history?"
      message="Every song will be removed from your listening history. This cannot be undone."
      confirm-label="Clear history"
      :busy="clearing"
      @confirm="clearAll"
      @cancel="confirmingClear = false"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useHistoryList } from '~/composables/useHistoryList';
import { usePlayTrackList } from '~/composables/usePlayTrackList';

// The logged-in user's played songs, one entry per song (its latest play),
// grouped by day. Rows can be removed one by one, or the whole history cleared.
const { user } = useAuth();
const { playFrom, currentTrack } = usePlayTrackList();
const {
  items, days, loading, error, loaded, hasMore, loadMore, remove, confirmingClear, clearing, clearAll,
} = useHistoryList<any>('/api/music/history', {
  timestampOf: (t) => t.playedAt,
  removeError: 'Could not remove the song from your history.',
  clearError: 'Could not clear your history.',
});

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
  margin-bottom: 8px;
}

.history-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
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
