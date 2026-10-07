<template>
  <div class="search-page">
    <h1 class="search-page-title">Results for "{{ query }}"</h1>

    <section v-if="isEnabled('video')" class="search-section">
      <h2 class="search-section-title">Videos</h2>
      <div v-if="videosPending" class="search-loading">Loading...</div>
      <div v-else-if="videosError" class="search-error">Failed to load videos.</div>
      <EmptyState
        v-else-if="videos.length === 0"
        icon="video"
        title="No videos"
        description="No videos match this search."
      />
      <template v-else>
        <div class="video-grid stagger-in">
          <VideoCard v-for="video in videos" :key="video.id" :video="video" :search-query="query" />
        </div>
        <NuxtLink :to="{ path: '/', query: { q: query } }" class="search-see-more">See more videos</NuxtLink>
      </template>
    </section>

    <section v-if="isEnabled('music')" class="search-section">
      <h2 class="search-section-title">Music</h2>
      <div v-if="tracksPending" class="search-loading">Loading...</div>
      <div v-else-if="tracksError" class="search-error">Failed to load music.</div>
      <EmptyState
        v-else-if="tracks.length === 0"
        icon="music"
        title="No tracks"
        description="No tracks match this search."
      />
      <template v-else>
        <div class="search-result-rows">
          <div
            v-for="track in tracks"
            :key="track.id"
            class="search-result-row"
            @click="playTrack(track)"
          >
            <span class="search-result-title" v-html="highlightMatch(track.title, query)"></span>
            <span class="search-result-subtitle">{{ track.artist_name }}</span>
          </div>
        </div>
        <NuxtLink :to="{ path: '/music', query: { q: query } }" class="search-see-more">See more music</NuxtLink>
      </template>
    </section>

    <section v-if="isEnabled('podcasts')" class="search-section">
      <h2 class="search-section-title">Podcasts</h2>
      <div v-if="episodesPending" class="search-loading">Loading...</div>
      <div v-else-if="episodesError" class="search-error">Failed to load podcasts.</div>
      <EmptyState
        v-else-if="episodes.length === 0"
        icon="music"
        title="No episodes"
        description="No episodes match this search."
      />
      <template v-else>
        <div class="search-result-rows">
          <div
            v-for="episode in episodes"
            :key="episode.id"
            class="search-result-row"
            @click="playEpisode(episode)"
          >
            <span class="search-result-title" v-html="highlightMatch(episode.title, query)"></span>
            <span class="search-result-subtitle">{{ episode.show_title }}</span>
          </div>
        </div>
        <NuxtLink :to="{ path: '/podcasts', query: { q: query } }" class="search-see-more">See more podcasts</NuxtLink>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { highlightMatch } from '../utils/highlightMatch';

const route = useRoute();
const query = computed(() => (route.query.q ? String(route.query.q) : ''));
const { isEnabled } = useModules();

const { play: playMusicTrack } = useMusicPlayer();
const { play: playPodcastEpisode } = usePodcastPlayer();

const videos = ref<any[]>([]);
const videosPending = ref(false);
const videosError = ref(false);

const tracks = ref<any[]>([]);
const tracksPending = ref(false);
const tracksError = ref(false);

const episodes = ref<any[]>([]);
const episodesPending = ref(false);
const episodesError = ref(false);

function playTrack(track: any) {
  playMusicTrack(track, tracks.value);
}

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

async function fetchVideos() {
  videosPending.value = true;
  videosError.value = false;
  try {
    const data = await $fetch<any>('/api/videos', { params: { q: query.value, status: 'completed', limit: 10 } });
    videos.value = data.videos || [];
  } catch (e) {
    videos.value = [];
    videosError.value = true;
  } finally {
    videosPending.value = false;
  }
}

async function fetchTracks() {
  tracksPending.value = true;
  tracksError.value = false;
  try {
    const data = await $fetch<any>('/api/music/tracks/search', { params: { q: query.value } });
    tracks.value = (data.tracks || []).slice(0, 10);
  } catch (e) {
    tracks.value = [];
    tracksError.value = true;
  } finally {
    tracksPending.value = false;
  }
}

async function fetchEpisodes() {
  episodesPending.value = true;
  episodesError.value = false;
  try {
    const data = await $fetch<any>('/api/podcasts/episodes/search', { params: { q: query.value } });
    episodes.value = (data.episodes || []).slice(0, 10);
  } catch (e) {
    episodes.value = [];
    episodesError.value = true;
  } finally {
    episodesPending.value = false;
  }
}

function fetchAll() {
  if (!query.value) {
    videos.value = [];
    tracks.value = [];
    episodes.value = [];
    return;
  }
  // Independent fetches: one section's failure must not block the others.
  if (isEnabled('video')) fetchVideos();
  if (isEnabled('music')) fetchTracks();
  if (isEnabled('podcasts')) fetchEpisodes();
}

watch(query, fetchAll, { immediate: true });
</script>

<style scoped>
.video-grid {
  display: grid;
  grid-template-columns: repeat(max(1, calc(4 + var(--grid-offset, 0))), 1fr);
  gap: 20px;
  margin-bottom: 32px;
}

@media (max-width: 1400px) {
  .video-grid { grid-template-columns: repeat(max(1, calc(3 + var(--grid-offset, 0))), 1fr); }
}

@media (max-width: 1000px) {
  .video-grid { grid-template-columns: repeat(max(1, calc(2 + var(--grid-offset, 0))), 1fr); }
}

@media (max-width: 640px) {
  .video-grid { grid-template-columns: 1fr; }
}

.search-page {
  padding: 24px;
}

.search-page-title {
  margin-bottom: 24px;
}

.search-section {
  margin-bottom: 32px;
}

.search-section-title {
  margin-bottom: 12px;
}

.search-see-more {
  display: inline-block;
  margin-top: 12px;
  color: var(--accent-primary);
}

.search-loading,
.search-error {
  color: var(--text-secondary);
  padding: 12px 0;
}

.search-result-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.search-result-row {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.search-result-row:hover {
  background: var(--surface-hover);
}

.search-result-title {
  font-weight: 500;
}

.search-result-subtitle {
  color: var(--text-secondary);
  margin-left: 8px;
  font-size: 13px;
}
</style>
