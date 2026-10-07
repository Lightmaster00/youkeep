<template>
  <div class="recent-page">
    <h1 class="page-title recent-title">Recently added</h1>

    <EmptyState
      v-if="loaded && items.length === 0 && !error"
      icon="music"
      title="Nothing here yet"
      description="Tracks appear here as soon as they are downloaded."
    />

    <div v-else class="media-grid">
      <MusicTrackCard
        v-for="track in items"
        :key="track.id"
        :track="track"
        :active="currentTrack?.id === track.id"
        show-actions
        @play="playTrack"
      />
    </div>

    <div v-if="loading" class="recent-status">Loading...</div>
    <div v-else-if="error" class="recent-status">
      Failed to load tracks.
      <button class="btn btn-secondary load-more-btn" @click="loadMore">Retry</button>
    </div>
    <div v-else-if="hasMore" class="recent-more">
      <button class="btn btn-secondary load-more-btn" @click="loadMore">Load more</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { useRecentList } from '~/composables/useRecentList';

const { currentTrack, play: playMusicTrack } = useMusicPlayer();
const { items, loading, error, loaded, hasMore, loadMore } = useRecentList('/api/music/playlists/recently-added', 'tracks');

// Same as the Library: a track plays with the loaded list as its queue.
function playTrack(track: any) {
  if (!track.local_file_path) return;
  playMusicTrack(track, items.value.filter((t) => t.local_file_path));
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
