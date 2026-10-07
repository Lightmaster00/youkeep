<template>
  <span v-if="user" class="music-track-actions" @click.stop @keydown.stop>
    <TrackLikeButton :track-id="trackId" />
    <AddToPlaylistMenu :track-id="trackId" class="music-track-actions-playlist" />
  </span>
</template>

<script setup lang="ts">
import { useAuth } from '~/composables/useAuth';

// Like + "Add to playlist" for a track row or card. Clicks and key presses
// stop here so they never also trigger the row's own "play" action.
defineProps<{ trackId: string }>();

const { user } = useAuth();
</script>

<style scoped>
.music-track-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
</style>
