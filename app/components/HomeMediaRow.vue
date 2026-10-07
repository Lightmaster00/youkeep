<template>
  <div class="content-row media-row" :data-testid="`home-row-${section.id}`">
    <div class="row-header">
      <h3 class="row-title">{{ section.title }}</h3>
      <NuxtLink :to="seeAllRoute" class="see-all-link">See all →</NuxtLink>
    </div>
    <div class="scroll-row">
      <div class="scroll-track">
        <template v-if="isMusic">
          <div v-for="track in section.tracks" :key="track.id" class="scroll-card">
            <MusicTrackCard :track="track" :active="currentTrack?.id === track.id" @play="playTrack" />
          </div>
        </template>
        <template v-else>
          <div v-for="episode in section.episodes" :key="episode.id" class="scroll-card">
            <PodcastEpisodeCard :episode="episode" :active="currentEpisode?.id === episode.id" @play="playEpisode" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';

// One Home row of music tracks (section id recentMusic) or podcast episodes
// (newEpisodes), as returned by /api/home/feed. Playing works like on the
// Music and Podcasts pages: a track plays with the row as its queue, an
// episode plays on its own.
const props = defineProps<{
  section: { id: 'recentMusic' | 'newEpisodes'; title: string; tracks?: any[]; episodes?: any[] };
}>();

const { currentTrack, play: playMusicTrack } = useMusicPlayer();
const { currentEpisode, play: playPodcastEpisode } = usePodcastPlayer();

const isMusic = computed(() => props.section.id === 'recentMusic');
const seeAllRoute = computed(() => (isMusic.value ? '/music/recent' : '/podcasts/recent'));

function playTrack(track: any) {
  if (!track.local_file_path) return;
  const queue = (props.section.tracks ?? []).filter((t) => t.local_file_path);
  playMusicTrack(track, queue);
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
/* Same row layout as the video rows of app/pages/index.vue. */
.content-row { margin-bottom: 32px; }
.row-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.row-title {
  font-size: 18px;
  font-weight: 700;
  color: white;
  margin: 0;
  letter-spacing: -0.01em;
}
.see-all-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-primary);
  text-decoration: none;
  white-space: nowrap;
}
.see-all-link:hover { color: var(--accent-primary-hover); }
.scroll-row {
  position: relative;
  width: calc(100% + 48px);
  margin-left: -24px;
  padding: 0 24px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  -webkit-overflow-scrolling: touch;
}
.scroll-track {
  display: flex;
  gap: 16px;
  /* Room for the card hover lift and shadow. */
  padding: 6px 0 8px;
}
.scroll-card {
  flex: 0 0 calc(180px * var(--grid-min-scale, 1));
  min-width: 0;
}
@media (max-width: 900px) {
  .scroll-card { flex: 0 0 calc(150px * var(--grid-min-scale, 1)); }
}
</style>
