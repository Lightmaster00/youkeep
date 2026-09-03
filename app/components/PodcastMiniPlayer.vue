<template>
  <audio
    ref="audioElRef"
    class="podcast-mini-player-audio"
    preload="metadata"
    @timeupdate="onTimeUpdate"
    @loadedmetadata="onLoadedMetadata"
    @durationchange="onLoadedMetadata"
    @ended="onEnded"
    @play="onPlay"
    @pause="isPlaying = false"
    @error="onAudioError"
  ></audio>

  <div v-if="currentEpisode" class="podcast-mini-player" :class="{ 'is-stacked': !!currentTrack }">
    <img :src="currentEpisode.show_cover_url || fallbackCover" @error="handleCoverError" class="podcast-mini-player-cover" alt="" />

    <div class="podcast-mini-player-info">
      <span class="podcast-mini-player-title">{{ currentEpisode.title }}</span>
      <span class="podcast-mini-player-show">{{ currentEpisode.show_title || '' }}</span>
    </div>

    <div class="podcast-mini-player-controls">
      <button @click="skipBack" class="podcast-mini-player-btn" title="Reculer de 15 secondes" aria-label="Reculer de 15 secondes">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
        <span class="podcast-mini-player-skip-label">15</span>
      </button>
      <button @click="togglePlay" class="podcast-mini-player-btn podcast-mini-player-play-btn" title="Lecture/Pause" aria-label="Lecture/Pause">
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </button>
      <button @click="skipForward" class="podcast-mini-player-btn" title="Avancer de 30 secondes" aria-label="Avancer de 30 secondes">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"></path></svg>
        <span class="podcast-mini-player-skip-label">30</span>
      </button>
    </div>

    <div class="podcast-mini-player-progress-row">
      <span class="podcast-mini-player-time">{{ formatPodcastTime(currentTime) }}</span>
      <div class="podcast-mini-player-progress-bar" @click="onProgressClick" ref="progressBarRef">
        <div class="podcast-mini-player-progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="podcast-mini-player-time">{{ formatPodcastTime(displayDuration) }}</span>
    </div>

    <div class="podcast-mini-player-extra-controls">
      <select
        class="podcast-mini-player-rate"
        :value="playbackRate"
        @change="onRateChange"
        title="Vitesse de lecture"
        aria-label="Vitesse de lecture"
      >
        <option v-for="rate in PLAYBACK_RATES" :key="rate" :value="rate">{{ rate }}x</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { usePodcastPlayer, formatPodcastTime, PLAYBACK_RATES } from '~/composables/usePodcastPlayer';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { useToast } from '~/composables/useToast';

const {
  currentEpisode, isPlaying, currentTime, duration, playbackRate, audioEl,
  togglePlay, seek, skipBack, skipForward, setPlaybackRate,
  saveToLocalStorage, restoreFromLocalStorage,
} = usePodcastPlayer();

// Read-only here: used to offset this bar above the music bar when both are
// loaded, and to stop music when podcast playback starts (Task 3 adds the
// mirror-image guard on the music side).
const { currentTrack, audioEl: musicAudioEl, isPlaying: musicIsPlaying } = useMusicPlayer();

const toast = useToast();
const audioElRef = ref<HTMLAudioElement | null>(null);
const progressBarRef = ref<HTMLDivElement | null>(null);

// Before metadata loads, duration.value is 0 — fall back to the RSS duration
// so the right-hand time label isn't stuck at 0:00 on a restored episode.
const displayDuration = computed(() => duration.value || currentEpisode.value?.duration || 0);
const progressPercent = computed(() =>
  displayDuration.value > 0 ? (currentTime.value / displayDuration.value) * 100 : 0
);

function onTimeUpdate() {
  if (!audioElRef.value) return;
  currentTime.value = audioElRef.value.currentTime;
  debouncedSave();
}

function onLoadedMetadata() {
  if (!audioElRef.value) return;
  const reported = audioElRef.value.duration;
  duration.value = Number.isFinite(reported) ? reported : 0;
  // Some browsers reset playbackRate when a new source loads.
  if (audioElRef.value.playbackRate !== playbackRate.value) {
    audioElRef.value.playbackRate = playbackRate.value;
  }
}

// No queue, so there is nothing to advance to — just stop and persist the
// finished position.
function onEnded() {
  isPlaying.value = false;
  saveToLocalStorage();
}

function onPlay() {
  isPlaying.value = true;
  // Never let two audio streams run at once.
  if (musicAudioEl.value && !musicAudioEl.value.paused) {
    musicAudioEl.value.pause();
    musicIsPlaying.value = false;
  }
}

function onAudioError() {
  toast.error('Erreur de lecture de l\'épisode.');
  isPlaying.value = false;
}

function onProgressClick(e: MouseEvent) {
  if (!progressBarRef.value || displayDuration.value <= 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  seek(ratio * displayDuration.value);
}

function onRateChange(e: Event) {
  setPlaybackRate(Number((e.target as HTMLSelectElement).value));
}

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaveTime = 0;
function debouncedSave() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveToLocalStorage();
    lastSaveTime = Date.now();
  }, 1000);

  const now = Date.now();
  if (now - lastSaveTime >= 5000) {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveToLocalStorage();
    lastSaveTime = now;
  }
}

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z\'></path><path d=\'M19 10v2a7 7 0 0 1-14 0v-2\'></path><line x1=\'12\' y1=\'19\' x2=\'12\' y2=\'23\'></line><line x1=\'8\' y1=\'23\' x2=\'16\' y2=\'23\'></line></svg>';

const handleCoverError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) {
    target.src = fallbackCover;
  }
};

watch(audioElRef, (el) => {
  audioEl.value = el;
}, { immediate: true });

onMounted(() => {
  restoreFromLocalStorage();
});
</script>

<style scoped>
.podcast-mini-player-audio {
  display: none;
}

.podcast-mini-player {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 72px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  background: rgba(15, 15, 22, 0.96);
  backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 900;
}

/* When a music track is also loaded, sit above the music bar instead of
   overlapping it. */
.podcast-mini-player.is-stacked {
  bottom: 72px;
}

.podcast-mini-player-cover {
  width: 48px;
  height: 48px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
}

.podcast-mini-player-info {
  display: flex;
  flex-direction: column;
  width: 220px;
  flex-shrink: 0;
  overflow: hidden;
}

.podcast-mini-player-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.podcast-mini-player-show {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.podcast-mini-player-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.podcast-mini-player-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  display: inline-flex;
  align-items: center;
  position: relative;
  transition: color 0.2s;
}

.podcast-mini-player-btn:hover {
  color: var(--text-primary);
}

.podcast-mini-player-skip-label {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 8px;
  font-weight: 700;
  pointer-events: none;
}

.podcast-mini-player-play-btn {
  background: var(--text-primary);
  color: var(--bg-base);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  justify-content: center;
}

.podcast-mini-player-play-btn:hover {
  color: var(--bg-base);
  opacity: 0.9;
}

.podcast-mini-player-progress-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.podcast-mini-player-time {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
  width: 52px;
}

.podcast-mini-player-progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}

.podcast-mini-player-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
}

.podcast-mini-player-extra-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.podcast-mini-player-rate {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  border-radius: var(--border-radius-md);
  font-size: 12px;
  padding: 4px 6px;
  cursor: pointer;
}

.podcast-mini-player-rate:hover {
  color: var(--text-primary);
}
</style>
