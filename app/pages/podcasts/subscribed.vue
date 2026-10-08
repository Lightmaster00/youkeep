<template>
  <div class="subscribed-page">
    <h1 class="page-title subscribed-title">Subscribed</h1>

    <EmptyState
      v-if="!user"
      icon="music"
      title="Log in to follow shows"
      description="Followed shows and your listening progress are kept per account."
    />

    <template v-else>
      <PodcastContinueRow show-empty />

      <section class="subscribed-section" aria-label="Your shows">
        <h2 class="subscribed-heading">Your shows</h2>
        <div v-if="showsLoading" class="subscribed-status">Loading...</div>
        <div v-else-if="showsError" class="subscribed-status">
          Failed to load your shows.
          <button class="btn btn-secondary" @click="loadShows">Retry</button>
        </div>
        <EmptyState
          v-else-if="visibleShows.length === 0"
          icon="music"
          title="You are not following any show yet"
          description="Open a show in the Library and press Follow to see its new episodes here."
        />
        <div v-else class="subscribed-grid">
          <PodcastShowCard v-for="s in visibleShows" :key="s.id" :show="s" :new-count="s.newCount" />
        </div>
      </section>

      <section v-if="visibleShows.length > 0" class="subscribed-section" aria-label="Latest from your shows">
        <h2 class="subscribed-heading">Latest from your shows</h2>
        <p v-if="loaded && items.length === 0 && !error" class="subscribed-status">No episodes yet.</p>
        <div v-else class="media-grid">
          <PodcastEpisodeCard
            v-for="episode in items"
            :key="episode.id"
            :episode="episode"
            :active="currentEpisode?.id === episode.id"
            show-actions
            @play="playEpisode"
          />
        </div>
        <div v-if="loading" class="subscribed-status">Loading...</div>
        <div v-else-if="error" class="subscribed-status">
          Failed to load episodes.
          <button class="btn btn-secondary" @click="loadMore">Retry</button>
        </div>
        <div v-else-if="hasMore" class="subscribed-more">
          <button class="btn btn-secondary" @click="loadMore">Load more</button>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { usePodcastFollows } from '~/composables/usePodcastFollows';
import { usePodcastProgress } from '~/composables/usePodcastProgress';
import { useRecentList } from '~/composables/useRecentList';
import { toPlayableEpisode } from '~/utils/playableEpisode';

// The logged-in user's followed shows ("N new" badges), what they are in the
// middle of, and the latest episodes of those shows.
const { user } = useAuth();
const { currentEpisode, play } = usePodcastPlayer();
const follows = usePodcastFollows();
const progressStore = usePodcastProgress();
const { items, loading, error, loaded, hasMore, loadMore } = useRecentList('/api/podcasts/subscribed-episodes', 'items');

const shows = ref<any[]>([]);
const showsLoading = ref(false);
const showsError = ref(false);

// Unfollowing a show here drops it from the grid at once.
const visibleShows = computed(() => shows.value.filter((s) => follows.isFollowed(s.id)));

async function loadShows() {
  showsLoading.value = true;
  showsError.value = false;
  try {
    shows.value = (await $fetch<any[]>('/api/podcasts/follows')) || [];
    follows.seed(shows.value.map((s) => s.id), true);
  } catch {
    showsError.value = true;
  } finally {
    showsLoading.value = false;
  }
}

watch(() => items.value.length, (length, previous) => {
  progressStore.seed(items.value.slice(previous ?? 0, length));
});

function playEpisode(ep: any) {
  const playable = toPlayableEpisode(ep);
  if (playable) play(playable);
}

onMounted(() => {
  if (!user.value) return;
  loadShows();
  loadMore();
});
</script>

<style scoped>
.subscribed-title { margin-bottom: 20px; }

.subscribed-section { margin-bottom: 32px; }

.subscribed-heading {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 12px;
}

.subscribed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
  gap: 16px;
}

@media (max-width: 640px) {
  .subscribed-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
}

.subscribed-status {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}

.subscribed-more {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
