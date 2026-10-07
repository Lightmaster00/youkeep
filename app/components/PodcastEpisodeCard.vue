<template>
  <div
    class="media-card"
    :class="{ 'now-playing': active, 'is-unplayable': !episode.local_file_path }"
    role="button"
    tabindex="0"
    :aria-label="`Play ${episode.title}`"
    @click="emit('play', episode)"
    @keydown.enter.prevent="emit('play', episode)"
  >
    <img :src="cover" @error="onCoverError" class="media-card-cover" alt="" />
    <div class="media-card-body">
      <h3 class="media-card-title" :title="episode.title">{{ episode.title }}</h3>
      <NuxtLink
        v-if="episode.show_id"
        :to="{ path: '/podcasts', query: { showId: episode.show_id } }"
        class="media-card-sub"
        @click.stop
      >{{ episode.show_title }}</NuxtLink>
      <p v-if="published" class="media-card-meta">{{ published }}</p>
      <PodcastEpisodeProgress :episode-id="episode.id" :duration="episode.duration" />
      <PodcastEpisodeMenu v-if="showActions" :episode-id="episode.id" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// Card for one episode (Home "New podcast episodes" row, /podcasts/recent,
// Continue listening). Same markup and look as the show cards of the Podcasts
// library. The logged-in user's progress shows under the date; `showActions`
// adds the "Mark as played / unplayed" menu.
const props = defineProps<{ episode: any; active?: boolean; showActions?: boolean }>();
const emit = defineEmits<{ play: [episode: any] }>();

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z\'></path><path d=\'M19 10v2a7 7 0 0 1-14 0v-2\'></path><line x1=\'12\' y1=\'19\' x2=\'12\' y2=\'23\'></line><line x1=\'8\' y1=\'23\' x2=\'16\' y2=\'23\'></line></svg>';

const cover = computed(() => props.episode.local_thumbnail_path || props.episode.show_cover_url || fallbackCover);

// pub_date is the raw RSS string: show it as a date when it parses, as is otherwise.
const published = computed(() => {
  const raw = props.episode.pub_date;
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
});

function onCoverError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) target.src = fallbackCover;
}
</script>
