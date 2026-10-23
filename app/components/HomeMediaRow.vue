<template>
  <HomeRow :title="section.title" :see-all="seeAllRoute" variant="media" :testid="`home-row-${section.id}`">
    <template v-if="isMusic">
      <div v-for="track in section.tracks" :key="track.id" class="row-item">
        <MusicTrackCard :track="track" :active="currentTrack?.id === track.id" @play="playTrack" />
      </div>
    </template>
    <template v-else>
      <div v-for="episode in section.episodes" :key="episode.id" class="row-item">
        <PodcastEpisodeCard :episode="episode" :active="currentEpisode?.id === episode.id" @play="playEpisode" />
      </div>
    </template>
  </HomeRow>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import HomeRow from '~/components/home/HomeRow.vue';
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
