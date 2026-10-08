<template>
  <div class="episode-row">
    <div class="episode-main">
      <h4 class="episode-title">{{ episode.title }}</h4>
      <p v-if="context" class="episode-context">{{ context }}</p>
      <p class="episode-meta">
        <span v-if="episode.season_number">S{{ episode.season_number }}</span>
        <span v-if="episode.episode_number">E{{ episode.episode_number }}</span>
        <span v-if="episode.pub_date">{{ formatPubDate(episode.pub_date) }}</span>
        <span>{{ formatDuration(episode.duration) }}</span>
      </p>
      <PodcastEpisodeProgress :episode-id="episode.id" :duration="episode.duration" />
    </div>
    <div class="episode-actions">
      <button
        v-if="playable"
        @click.stop="emit('play', episode)"
        class="episode-play-btn"
        title="Play episode"
        aria-label="Play episode"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </button>
      <span class="badge" :class="statusBadgeClass(episode.download_status)">{{ formatStatus(episode.download_status) }}</span>
      <PodcastEpisodeMenu v-if="playable" :episode-id="episode.id" />
      <button v-if="canEdit" @click.stop="emit('edit', episode)" class="edit-btn" title="Edit" aria-label="Edit episode">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// One episode of the show detail list: title, meta, the user's progress, and
// the play / status / "Mark as played" / admin edit actions. On phones the
// actions move to their own line under the title. `context` adds a line under
// the title (Discover: show title and listener count).
const props = defineProps<{ episode: any; canEdit?: boolean; context?: string }>();
const emit = defineEmits<{ play: [episode: any]; edit: [episode: any] }>();

const playable = computed(() => props.episode.download_status === 'completed' && !!props.episode.local_file_path);

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// pub_date is the raw RSS date string (TEXT), so it may be unparseable —
// fall back to showing it verbatim rather than "Invalid Date".
function formatPubDate(raw: string | null): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatStatus(status: string): string {
  switch (status) {
    case 'completed': return 'Downloaded';
    case 'downloading': return 'In progress';
    case 'pending': return 'Queued';
    case 'failed': return 'Failed';
    default: return status || 'Queued';
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'completed': return 'badge-completed';
    case 'downloading': return 'badge-downloading';
    case 'failed': return 'badge-failed';
    default: return 'badge-pending';
  }
}
</script>

<style scoped>
.episode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
}

.episode-row:last-child {
  border-bottom: none;
}

.episode-main {
  flex: 1;
  min-width: 0;
}

.episode-title {
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.episode-context {
  font-size: 13px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.episode-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.episode-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Phones: the actions would squeeze the title to a few pixels, so they move
   to their own line under the title (same rule as MusicTrackList.vue). */
@media (max-width: 560px) {
  .episode-row {
    flex-wrap: wrap;
    row-gap: 6px;
  }

  .episode-main {
    flex-basis: 100%;
  }

  .episode-actions {
    flex-wrap: wrap;
  }
}

.edit-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  display: inline-flex;
  align-items: center;
  transition: color 0.2s;
  flex-shrink: 0;
}

.edit-btn:hover {
  color: var(--text-primary);
}

.episode-play-btn {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 26px;
  height: 26px;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: color 0.2s, border-color 0.2s;
  flex-shrink: 0;
}

.episode-play-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-primary);
}
</style>
