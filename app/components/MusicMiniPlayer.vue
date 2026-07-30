<template>
  <audio
    ref="audioElRef"
    @timeupdate="onTimeUpdate"
    @loadedmetadata="onLoadedMetadata"
    @durationchange="onLoadedMetadata"
    @ended="onEnded"
    @play="isPlaying = true"
    @pause="isPlaying = false"
    @error="onAudioError"
  ></audio>

  <div v-if="currentTrack" class="mini-player">
    <img :src="currentTrack.local_thumbnail_path || fallbackCover" class="mini-player-cover" alt="" />

    <div class="mini-player-info">
      <span class="mini-player-title">{{ currentTrack.title }}</span>
      <span class="mini-player-artist">{{ currentTrack.artist_name || '' }}</span>
    </div>

    <div class="mini-player-controls">
      <button @click="prev" class="mini-player-btn" title="Précédent">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"></line></svg>
      </button>
      <button @click="togglePlay" class="mini-player-btn mini-player-play-btn" title="Lecture/Pause">
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </button>
      <button @click="next" class="mini-player-btn" title="Suivant">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg>
      </button>
    </div>

    <div class="mini-player-progress-row">
      <span class="mini-player-time">{{ formatDuration(currentTime) }}</span>
      <div class="mini-player-progress-bar" @click="onProgressClick" ref="progressBarRef">
        <div class="mini-player-progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="mini-player-time">{{ formatDuration(duration) }}</span>
    </div>

    <div class="mini-player-extra-controls">
      <button @click="toggleShuffle" class="mini-player-btn" :class="{ active: shuffleOn }" title="Aléatoire">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
      </button>
      <button @click="cycleRepeat" class="mini-player-btn" :class="{ active: repeatMode !== 'off' }" title="Répétition">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
        <span v-if="repeatMode === 'one'" class="repeat-one-badge">1</span>
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        v-model.number="volume"
        @input="onVolumeChange"
        class="mini-player-volume"
        title="Volume"
        aria-label="Volume"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { useToast } from '~/composables/useToast';

const {
  currentTrack, isPlaying, currentTime, duration,
  audioEl, shuffleOn, repeatMode,
  togglePlay, seek, next, prev, toggleShuffle, cycleRepeat,
  recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
} = useMusicPlayer();

const toast = useToast();
const audioElRef = ref<HTMLAudioElement | null>(null);
const progressBarRef = ref<HTMLDivElement | null>(null);
const volume = ref(1);

const progressPercent = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0));

function onTimeUpdate() {
  if (!audioElRef.value) return;
  currentTime.value = audioElRef.value.currentTime;
  recordPlayIfThresholdReached();
  debouncedSave();
}

function onLoadedMetadata() {
  if (!audioElRef.value) return;
  duration.value = audioElRef.value.duration || 0;
}

function onEnded() {
  next();
}

function onAudioError() {
  toast.error('Erreur de lecture audio.');
  isPlaying.value = false;
}

function onProgressClick(e: MouseEvent) {
  if (!progressBarRef.value || duration.value <= 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  seek(ratio * duration.value);
}

function onVolumeChange() {
  if (audioElRef.value) audioElRef.value.volume = volume.value;
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

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M9 18V5l12-2v13\'></path><circle cx=\'6\' cy=\'18\' r=\'3\'></circle><circle cx=\'18\' cy=\'16\' r=\'3\'></circle></svg>';

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

watch(audioElRef, (el) => {
  audioEl.value = el;
  if (el) el.volume = volume.value;
}, { immediate: true });

onMounted(async () => {
  await restoreFromLocalStorage();
});
</script>

<style scoped>
.mini-player {
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

.mini-player-cover {
  width: 48px;
  height: 48px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
}

.mini-player-info {
  display: flex;
  flex-direction: column;
  width: 180px;
  flex-shrink: 0;
  overflow: hidden;
}

.mini-player-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-player-artist {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-player-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mini-player-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  display: inline-flex;
  align-items: center;
  transition: color 0.2s;
}

.mini-player-btn:hover {
  color: var(--text-primary);
}

.mini-player-btn.active {
  color: var(--accent-primary);
}

.mini-player-play-btn {
  background: var(--text-primary);
  color: var(--bg-base);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  justify-content: center;
}

.mini-player-play-btn:hover {
  color: var(--bg-base);
  opacity: 0.9;
}

.mini-player-progress-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mini-player-time {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
  width: 36px;
}

.mini-player-progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}

.mini-player-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
}

.mini-player-extra-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.repeat-one-badge {
  position: absolute;
  font-size: 8px;
  font-weight: 700;
  margin-left: -6px;
  margin-top: 6px;
}

.mini-player-volume {
  width: 80px;
}
</style>
