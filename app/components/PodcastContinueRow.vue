<template>
  <section v-if="user && (items.length > 0 || (showEmpty && loaded))" class="continue-row" aria-label="Continue listening">
    <h2 class="continue-title">Continue listening</h2>
    <p v-if="items.length === 0" class="continue-empty">Nothing in progress</p>
    <div v-else class="continue-scroll">
      <div v-for="episode in items" :key="episode.id" class="continue-card">
        <PodcastEpisodeCard
          :episode="episode"
          :active="currentEpisode?.id === episode.id"
          show-actions
          @play="playEpisode"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { usePodcastProgress } from '~/composables/usePodcastProgress';
import { toPlayableEpisode } from '~/utils/playableEpisode';

// "Continue listening": the logged-in user's started, unfinished episodes
// (Podcasts library and Subscribed page). Hidden when there is nothing in
// progress unless `showEmpty`, and always for guests.
defineProps<{ showEmpty?: boolean }>();

const { user } = useAuth();
const { currentEpisode, play } = usePodcastPlayer();
const progressStore = usePodcastProgress();
const items = ref<any[]>([]);
const loaded = ref(false);

async function load() {
  if (!user.value) return;
  try {
    const data = await $fetch<{ items: any[] }>('/api/podcasts/continue', { params: { limit: 12 } });
    items.value = data?.items ?? [];
    progressStore.seed(items.value);
  } catch {
    items.value = [];
  } finally {
    loaded.value = true;
  }
}

function playEpisode(ep: any) {
  const playable = toPlayableEpisode(ep);
  if (playable) play(playable);
}

onMounted(load);
</script>

<style scoped>
.continue-row {
  margin-bottom: 28px;
  min-width: 0;
}

.continue-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 12px;
}

.continue-empty {
  color: var(--text-secondary);
  font-size: 14px;
}

.continue-scroll {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 4px 0 8px;
  scroll-snap-type: x proximity;
}

.continue-card {
  flex: 0 0 180px;
  min-width: 0;
  scroll-snap-align: start;
}

@media (max-width: 560px) {
  .continue-card {
    flex-basis: 150px;
  }
}
</style>
