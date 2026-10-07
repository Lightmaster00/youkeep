<template>
  <ol class="music-track-list">
    <li
      v-for="(track, index) in tracks"
      :key="track.id"
      class="mtl-row"
      :class="{ 'now-playing': activeId === track.id, 'is-unplayable': !track.local_file_path }"
      tabindex="0"
      :aria-label="`Play ${track.title}`"
      @click="emit('play', track)"
      @keydown.enter.self.prevent="emit('play', track)"
    >
      <span class="mtl-index">{{ index + 1 }}</span>
      <img :src="coverOf(track)" class="mtl-cover" alt="" loading="lazy" @error="onCoverError" />
      <span class="mtl-text">
        <span class="mtl-title">{{ track.title }}</span>
        <span class="mtl-artist">{{ track.artist_name }}</span>
      </span>
      <span class="mtl-album">{{ track.album_title || '' }}</span>
      <span class="mtl-duration">{{ formatDuration(track.duration) }}</span>
      <span class="mtl-actions" @click.stop @keydown.stop>
        <MusicTrackActions :track-id="track.id" />
        <slot name="actions" :track="track" :index="index" />
      </span>
    </li>
  </ol>
</template>

<script setup lang="ts">
// Numbered track list for Liked songs and personal playlists. Clicking a row
// emits `play`; the `actions` slot adds per-row buttons after like/add.
defineProps<{ tracks: any[]; activeId?: string | null }>();
const emit = defineEmits<{ play: [track: any] }>();

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M9 18V5l12-2v13\'></path><circle cx=\'6\' cy=\'18\' r=\'3\'></circle><circle cx=\'18\' cy=\'16\' r=\'3\'></circle></svg>';

function coverOf(track: any): string {
  return track.local_thumbnail_path || track.album_cover_url || fallbackCover;
}

function onCoverError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) target.src = fallbackCover;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '--:--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}
</script>

<style scoped>
.music-track-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.mtl-row {
  display: grid;
  grid-template-columns: 28px 40px minmax(0, 2fr) minmax(0, 1fr) 52px auto;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
  border-radius: var(--border-radius-sm);
  font-size: 14px;
  cursor: pointer;
}

.mtl-row:hover,
.mtl-row:focus-visible {
  background: rgba(255, 255, 255, 0.04);
  outline: none;
}

.mtl-row.now-playing .mtl-title,
.mtl-row.now-playing .mtl-index {
  color: var(--accent-primary);
}

.mtl-row.is-unplayable {
  cursor: default;
  opacity: 0.6;
}

.mtl-index {
  text-align: right;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.mtl-cover {
  width: 40px;
  height: 40px;
  border-radius: var(--border-radius-sm);
  object-fit: cover;
}

.mtl-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mtl-title,
.mtl-artist,
.mtl-album {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mtl-title {
  font-weight: 500;
}

.mtl-artist,
.mtl-album {
  font-size: 13px;
  color: var(--text-secondary);
}

.mtl-duration {
  text-align: right;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.mtl-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

@media (max-width: 768px) {
  .mtl-row {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: 10px;
    padding: 6px 4px;
  }

  .mtl-index,
  .mtl-album,
  .mtl-duration {
    display: none;
  }
}

/* Phones: the action buttons would squeeze the title to a few pixels, so they
   move to their own line under the title. */
@media (max-width: 560px) {
  .mtl-row {
    grid-template-columns: 40px minmax(0, 1fr);
    row-gap: 2px;
  }

  .mtl-actions {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
