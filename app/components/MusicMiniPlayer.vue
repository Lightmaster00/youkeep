<template>
  <video
    ref="audioElRef"
    :style="{ opacity: clipMode && showBar ? 1 : 0, pointerEvents: clipMode && showBar ? 'auto' : 'none' }"
    class="mini-player-video"
    playsinline
    webkit-playsinline
    @timeupdate="onTimeUpdate"
    @loadedmetadata="onLoadedMetadata"
    @durationchange="onLoadedMetadata"
    @ended="onEnded"
    @play="onPlay"
    @pause="isPlaying = false"
    @error="onAudioError"
  ></video>

  <div v-if="showBar && currentTrack" class="mini-player">
    <img :style="{ visibility: clipMode ? 'hidden' : 'visible' }" :src="thumbUrl(currentTrack.local_thumbnail_path, 160) || fallbackCover" class="mini-player-cover" alt="" decoding="async" />

    <div class="mini-player-info">
      <span class="mini-player-title">{{ currentTrack.title }}</span>
      <span class="mini-player-artist">{{ currentTrack.artist_name || '' }}</span>
    </div>

    <span class="mini-player-track-actions">
      <TrackLikeButton :track-id="currentTrack.id" />
      <AddToPlaylistMenu :track-id="currentTrack.id" class="mini-player-add-to-playlist" />
    </span>

    <button
      v-if="currentTrack.has_clip"
      @click="setClipMode(!clipMode)"
      class="mini-player-btn mini-player-clip-toggle"
      :class="{ active: clipMode }"
      :title="clipMode ? t('music.player.audioMode') : t('music.extras.clipTitle')"
      :aria-label="clipMode ? t('music.player.audioMode') : t('music.extras.clipTitle')"
      :aria-pressed="clipMode"
    >
      🎬
    </button>

    <div class="mini-player-controls">
      <button type="button" @click="prev" class="mini-player-btn" :title="t('music.player.previous')" :aria-label="t('music.player.previous')">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"></line></svg>
      </button>
      <button type="button" @click="togglePlay" class="mini-player-btn mini-player-play-btn" :title="isPlaying ? t('music.pause') : t('music.play')" :aria-label="isPlaying ? t('music.pause') : t('music.play')">
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </button>
      <button type="button" @click="next" class="mini-player-btn" :title="t('music.player.next')" :aria-label="t('music.player.next')">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg>
      </button>
    </div>

    <button
      type="button"
      class="mini-player-btn mini-player-more-btn"
      :aria-expanded="moreOpen ? 'true' : 'false'"
      aria-controls="music-player-more"
      :aria-label="t('music.player.moreControls')"
      :title="t('music.player.more')"
      data-testid="music-more-btn"
      @click="moreOpen = !moreOpen"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>
    </button>

    <div class="mini-player-progress-row">
      <span class="mini-player-time" aria-hidden="true">{{ formatDuration(currentTime) }}</span>
      <!-- A real slider: Arrow keys, Home/End and screen readers work. -->
      <input
        type="range"
        class="mini-player-seek"
        data-testid="music-seek"
        min="0"
        :max="Math.max(0, Math.floor(duration))"
        step="1"
        :value="Math.floor(currentTime)"
        :aria-label="t('music.player.seek')"
        :aria-valuetext="t('music.player.seekValue', { current: formatDuration(currentTime), total: formatDuration(duration) })"
        :disabled="duration <= 0"
        @input="onSeekInput"
      />
      <span class="mini-player-time" aria-hidden="true">{{ formatDuration(duration) }}</span>
    </div>

    <div
      id="music-player-more"
      class="mini-player-extra-controls"
      :class="{ 'is-open': moreOpen }"
      role="group"
      :aria-label="t('music.player.moreControls')"
      data-testid="music-more"
      @keydown.esc="moreOpen = false"
    >
      <AddToPlaylistMenu :track-id="currentTrack.id" class="mini-player-more-only" />
      <button
        v-if="currentTrack.has_clip"
        type="button"
        @click="setClipMode(!clipMode)"
        class="mini-player-btn mini-player-more-only"
        :class="{ active: clipMode }"
        :aria-label="clipMode ? t('music.player.audioMode') : t('music.extras.clipTitle')"
        :aria-pressed="clipMode"
      >🎬</button>
      <button type="button" @click="toggleShuffle" class="mini-player-btn" :class="{ active: shuffleOn }" :title="t('music.shuffle')" :aria-label="t('music.shuffle')" :aria-pressed="shuffleOn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
      </button>
      <button type="button" @click="cycleRepeat" class="mini-player-btn" :class="{ active: repeatMode !== 'off' }" :title="repeatLabel" :aria-label="repeatLabel">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
        <span v-if="repeatMode === 'one'" class="repeat-one-badge">1</span>
      </button>
      <button type="button" @click="startRadio" class="mini-player-btn" :title="t('music.player.radio')" :aria-label="t('music.player.radio')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"></path><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"></path><circle cx="12" cy="12" r="2"></circle><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"></path><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"></path></svg>
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        v-model.number="volume"
        @input="onVolumeChange"
        class="mini-player-volume"
        :title="t('music.player.volume')"
        :aria-label="t('music.player.volume')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { thumbUrl } from '~/utils/thumb';
import { ref, computed, onMounted, watch } from 'vue';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { useToast } from '~/composables/useToast';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { useActiveMiniPlayer } from '~/composables/useActiveMiniPlayer';

const {
  currentTrack, isPlaying, currentTime, duration,
  audioEl, shuffleOn, repeatMode, clipMode,
  togglePlay, seek, next, prev, toggleShuffle, cycleRepeat, setClipMode, replaceQueueKeepingCurrent,
  recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage, restoring,
} = useMusicPlayer();

const toast = useToast();
const { t } = useI18n();

// "Repeat: off", worded in the UI language
const repeatLabel = computed(() => t('music.player.repeat', { mode: t(`music.player.repeatMode.${repeatMode.value}`) }));

// Podcast playback is a separate <audio> element in PodcastMiniPlayer.vue;
// never let both stream at once. PodcastMiniPlayer.vue holds the mirror-image
// guard for the other direction. currentEpisode is read here for the
// single-visible-bar rule, not for playback.
const { audioEl: podcastAudioEl, isPlaying: podcastIsPlaying, currentEpisode } = usePodcastPlayer();

// Exactly one mini-player bar is ever on screen. The music bar shows when it
// has a track loaded AND either music is the most recently activated type, or
// the podcast player has nothing loaded to compete with. Both media elements
// stay mounted regardless, so the hidden side stays loaded and paused, ready
// to resume the moment the user presses play on it from its own page.
const { activeType } = useActiveMiniPlayer();
const showBar = computed(() => !!currentTrack.value && (activeType.value === 'music' || !currentEpisode.value));

function onPlay() {
  isPlaying.value = true;
  if (podcastAudioEl.value && !podcastAudioEl.value.paused) {
    podcastAudioEl.value.pause();
    podcastIsPlaying.value = false;
  }
}

const audioElRef = ref<HTMLVideoElement | null>(null);
const volume = ref(1);


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
  // The track restored on page load is stale: the player clears it silently.
  if (restoring.value || !currentTrack.value) return;
  toast.error(t('music.player.error'));
  isPlaying.value = false;
  setClipMode(false);
}

function onSeekInput(e: Event) {
  if (duration.value <= 0) return;
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(value)) seek(Math.min(duration.value, Math.max(0, value)));
}

// Phones: shuffle, repeat, radio, add-to-playlist, clip and volume live in a
// "More" sheet instead of being hidden outright.
const moreOpen = ref(false);
watch(() => currentTrack.value?.id, () => { moreOpen.value = false; });

function onVolumeChange() {
  if (audioElRef.value) audioElRef.value.volume = volume.value;
}

let radioRequestId = 0;

async function startRadio() {
  if (!currentTrack.value) return;
  const requestId = ++radioRequestId;
  const seedTrackId = currentTrack.value.id;
  try {
    const data = await $fetch<any>('/api/music/playlists/radio', { params: { trackId: seedTrackId } });
    if (requestId !== radioRequestId) return;
    if (currentTrack.value?.id !== seedTrackId) return;
    if (data.tracks?.length > 0) {
      replaceQueueKeepingCurrent(currentTrack.value, data.tracks);
    }
  } catch (e) {
    // Fail silently and leave the current queue untouched — consistent with
    // how music/index.vue's fetchPlaylists() treats each automatic-playlist
    // fetch as independently best-effort.
  }
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
  // audioElRef is populated synchronously by Vue during mount, but the
  // `watch(audioElRef, ...)` callback above only runs on the next reactivity
  // flush (a microtask) — after this onMounted callback. Assign audioEl
  // directly here first so restoreFromLocalStorage()'s loadTrack() call
  // sees a real element instead of null and actually sets `el.src`.
  audioEl.value = audioElRef.value;
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

.mini-player-video {
  position: fixed;
  bottom: 12px;
  left: 24px;
  width: 48px;
  height: 48px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  background: #000;
  z-index: 901;
}

.mini-player-clip-toggle {
  font-size: 16px;
}

.mini-player-clip-toggle.active {
  color: var(--accent-primary);
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

.mini-player-track-actions {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
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
  min-width: 100px;
}

.mini-player-time {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
  width: 36px;
}

.mini-player-seek {
  flex: 1;
  min-width: 24px;
  height: 16px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--accent-primary);
  background: transparent;
}

.mini-player-seek:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.mini-player-more-btn,
.mini-player-more-only {
  display: none !important;
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

/* Three breakpoints, sized against a single-bar width budget (only one
   mini-player is ever laid out now).
   Desktop (no query): fixed siblings total 680px with a clip loaded, so the
   bar stops fitting below ~792px — 900px fires ~108px before that, which is
   why raising the old 800px threshold is safe.
   Medium (<= 900px): the volume slider and the clip toggle must go here, not
   at 480px — keeping the slider costs 86px and would overflow the bar by
   ~59px at 481px. Without them, fixed siblings total 358px and the seek bar
   still measures 51px at 481px.
   Compact (<= 480px): shuffle/repeat/radio are hidden outright too (volume is
   already gone), leaving cover art, a single truncated title line,
   prev/play/next and the seek bar. Fixed siblings total 228px, leaving a 28px
   seek bar at a 320px viewport. */
@media (max-width: 900px) {
  .mini-player {
    padding: 0 10px;
    gap: 8px;
  }

  .mini-player-cover {
    width: 36px;
    height: 36px;
  }

  /* Keep the clip video square aligned with the cover art it replaces. */
  .mini-player-video {
    left: 10px;
    bottom: 18px;
    width: 36px;
    height: 36px;
  }

  .mini-player-info {
    width: 96px;
  }

  .mini-player-clip-toggle {
    display: none;
  }

  .mini-player-controls {
    gap: 4px;
  }

  .mini-player-btn {
    padding: 4px;
  }

  .mini-player-play-btn {
    width: 30px;
    height: 30px;
  }

  .mini-player-progress-row {
    gap: 6px;
  }

  .mini-player-time {
    width: 30px;
    font-size: 10px;
  }

  /* The extra controls move into the "More" sheet above the bar. */
  .mini-player-more-btn {
    display: inline-flex !important;
  }

  .mini-player-extra-controls {
    display: none;
  }

  .mini-player-extra-controls.is-open {
    display: flex;
    position: fixed;
    left: 8px;
    right: 8px;
    bottom: calc(var(--music-bar-height, 72px) + 8px);
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
    padding: 12px;
    border-radius: 14px;
    background: rgb(22, 22, 32);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
    z-index: 950;
  }

  .mini-player-extra-controls.is-open .mini-player-more-only {
    display: inline-flex !important;
  }

  .mini-player-extra-controls.is-open .mini-player-volume {
    width: 140px;
  }
}

@media (max-width: 480px) {
  /* Two rows: the controls, then a full-width seek bar. */
  .mini-player {
    --music-bar-height: 84px;
    height: auto;
    min-height: 72px;
    flex-wrap: wrap;
    row-gap: 2px;
    padding: 6px 8px;
    gap: 6px;
  }

  .mini-player-info {
    flex: 1 1 auto;
    min-width: 0;
  }

  .mini-player-cover {
    width: 32px;
    height: 32px;
  }

  .mini-player-video {
    left: 8px;
    bottom: 40px;
    width: 32px;
    height: 32px;
  }

  .mini-player-info {
    width: 72px;
  }

  /* The like button stays; "Add to playlist" is on every track row. */
  .mini-player-track-actions .mini-player-add-to-playlist {
    display: none;
  }

  /* Single truncated line: the artist name is the one that goes. */
  .mini-player-artist {
    display: none;
  }

  .mini-player-progress-row {
    order: 10;
    flex: 1 0 100%;
    gap: 4px;
  }

  .mini-player-time {
    width: 28px;
  }
}
</style>
