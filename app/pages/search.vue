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
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { highlightMatch } from '../utils/highlightMatch';

useHead({ title: 'Search' });

const route = useRoute();
const query = computed(() => (route.query.q ? String(route.query.q) : ''));
const { isEnabled } = useModules();

const { play: playMusicTrack } = useMusicPlayer();
const { play: playPodcastEpisode } = usePodcastPlayer();

// One useAsyncData per section, through useRequestFetch: the SSR render
// carries the viewer's cookies (private results included) and hydrates as is.
const requestFetch = useRequestFetch();
const seed = useFeedSeed();
const section = (key: string, enabled: () => boolean, load: () => Promise<any[]>) => useAsyncData<any[]>(
  () => `search-${key}:${query.value}`,
  () => (query.value && enabled() ? load() : Promise.resolve([])),
  { default: () => [] },
);

const [videosState, tracksState, episodesState] = await Promise.all([
  section('videos', () => isEnabled('video'), async () =>
    ((await requestFetch<any>('/api/videos', { params: { q: query.value, status: 'completed', limit: 10, seed } }))?.videos || [])),
  section('tracks', () => isEnabled('music'), async () =>
    ((await requestFetch<any>('/api/music/tracks/search', { params: { q: query.value } }))?.tracks || []).slice(0, 10)),
  section('episodes', () => isEnabled('podcasts'), async () =>
    ((await requestFetch<any>('/api/podcasts/episodes/search', { params: { q: query.value } }))?.episodes || []).slice(0, 10)),
]);

const videos = computed(() => videosState.data.value || []);
const videosPending = computed(() => videosState.pending.value);
const videosError = computed(() => !!videosState.error.value);
const tracks = computed(() => tracksState.data.value || []);
const tracksPending = computed(() => tracksState.pending.value);
const tracksError = computed(() => !!tracksState.error.value);
const episodes = computed(() => episodesState.data.value || []);
const episodesPending = computed(() => episodesState.pending.value);
const episodesError = computed(() => !!episodesState.error.value);

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
