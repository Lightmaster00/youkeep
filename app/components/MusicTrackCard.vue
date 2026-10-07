<template>
  <div
    class="media-card"
    :class="{ 'now-playing': active, 'is-unplayable': !track.local_file_path }"
    role="button"
    tabindex="0"
    :aria-label="`Play ${track.title}`"
    @click="emit('play', track)"
    @keydown.enter.prevent="emit('play', track)"
  >
    <img :src="cover" @error="onCoverError" class="media-card-cover" alt="" />
    <div class="media-card-body">
      <h3 class="media-card-title" :title="track.title">{{ track.title }}</h3>
      <NuxtLink
        v-if="track.artist_id"
        :to="{ path: '/music', query: { artistId: track.artist_id } }"
        class="media-card-sub"
        @click.stop
      >{{ track.artist_name }}</NuxtLink>
      <p v-if="track.album_title" class="media-card-meta">{{ track.album_title }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// Card for one track (Home "Recently added music" row, /music/recent). Same
// markup and look as the show cards of the Podcasts library.
const props = defineProps<{ track: any; active?: boolean }>();
const emit = defineEmits<{ play: [track: any] }>();

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M9 18V5l12-2v13\'></path><circle cx=\'6\' cy=\'18\' r=\'3\'></circle><circle cx=\'18\' cy=\'16\' r=\'3\'></circle></svg>';

const cover = computed(() => props.track.local_thumbnail_path || props.track.album_cover_url || fallbackCover);

function onCoverError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) target.src = fallbackCover;
}
</script>
