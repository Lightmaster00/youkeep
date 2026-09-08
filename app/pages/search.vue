<template>
  <div class="search-page">
    <h1 class="search-page-title">Résultats pour "{{ query }}"</h1>

    <section class="search-section">
      <h2 class="search-section-title">Vidéos</h2>
      <div v-if="videosPending" class="search-loading">Chargement...</div>
      <div v-else-if="videosError" class="search-error">Erreur lors du chargement des vidéos.</div>
      <EmptyState
        v-else-if="videos.length === 0"
        icon="video"
        title="Aucune vidéo"
        description="Aucune vidéo ne correspond à cette recherche."
      />
      <template v-else>
        <div class="video-grid stagger-in">
          <VideoCard v-for="video in videos" :key="video.id" :video="video" :search-query="query" />
        </div>
        <NuxtLink :to="{ path: '/', query: { q: query } }" class="search-see-more">Voir plus de vidéos</NuxtLink>
      </template>
    </section>

    <section class="search-section">
      <h2 class="search-section-title">Musique</h2>
      <div v-if="tracksPending" class="search-loading">Chargement...</div>
      <div v-else-if="tracksError" class="search-error">Erreur lors du chargement de la musique.</div>
      <EmptyState
        v-else-if="tracks.length === 0"
        icon="music"
        title="Aucun titre"
        description="Aucun titre ne correspond à cette recherche."
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
        <NuxtLink :to="{ path: '/music', query: { q: query } }" class="search-see-more">Voir plus de musique</NuxtLink>
      </template>
    </section>

    <section class="search-section">
      <h2 class="search-section-title">Podcasts</h2>
      <div v-if="episodesPending" class="search-loading">Chargement...</div>
      <div v-else-if="episodesError" class="search-error">Erreur lors du chargement des podcasts.</div>
      <EmptyState
        v-else-if="episodes.length === 0"
        icon="music"
        title="Aucun épisode"
        description="Aucun épisode ne correspond à cette recherche."
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
        <NuxtLink :to="{ path: '/podcasts', query: { q: query } }" class="search-see-more">Voir plus de podcasts</NuxtLink>
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
  fetchVideos();
  fetchTracks();
  fetchEpisodes();
}

watch(query, fetchAll, { immediate: true });
</script>

<style scoped>
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
