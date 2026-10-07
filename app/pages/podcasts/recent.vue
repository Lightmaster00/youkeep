<template>
  <div class="recent-page">
    <h1 class="page-title recent-title">New episodes</h1>

    <EmptyState
      v-if="loaded && items.length === 0 && !error"
      icon="music"
      title="Nothing here yet"
      description="Episodes appear here as soon as they are downloaded."
    />

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

    <div v-if="loading" class="recent-status">Loading...</div>
    <div v-else-if="error" class="recent-status">
      Failed to load episodes.
      <button class="btn btn-secondary load-more-btn" @click="loadMore">Retry</button>
    </div>
    <div v-else-if="hasMore" class="recent-more">
      <button class="btn btn-secondary load-more-btn" @click="loadMore">Load more</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { useRecentList } from '~/composables/useRecentList';

const { currentEpisode, play: playPodcastEpisode } = usePodcastPlayer();
const { items, loading, error, loaded, hasMore, loadMore } = useRecentList('/api/podcasts/episodes/recent', 'episodes');

// Same as the Library: the episode plays on its own, with its show's cover.
function playEpisode(ep: any) {
  if (!ep.local_file_path) return;
  playPodcastEpisode({
    id: ep.id,
    title: ep.title,
    show_title: ep.show_title,
    show_cover_url: ep.show_cover_url ?? null,
    duration: ep.duration ?? null,
    local_file_path: ep.local_file_path,
  });
}

onMounted(loadMore);
</script>

<style scoped>
.recent-title { margin-bottom: 20px; }
.recent-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}
.recent-more {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
