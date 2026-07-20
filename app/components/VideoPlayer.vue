<template>
  <div
    class="video-player-container"
    ref="playerContainer"
    @mouseenter="showControls = true"
    @mouseleave="handleMouseLeave"
    @mousemove="handleMouseMove"
    @dblclick="toggleFullscreen"
    :class="{ 'controls-visible': showControls || isPaused, 'is-short-player': video?.is_short === 1 }"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <video
      ref="videoPlayer"
      class="video-player"
      :poster="video.local_thumbnail_path || (video.id ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : '')"
      :src="video.local_video_path ? `${video.local_video_path}${token ? `?token=${token}` : ''}` : ''"
      preload="metadata"
      :loop="video?.is_short === 1"
      @click="togglePlay"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onMetadataLoaded"
      @durationchange="onDurationChange"
      @play="onPlayTrigger"
      @pause="onPauseTrigger"
      @ended="onEnded"
      @volumechange="onVolumeChange"
      @waiting="isBuffering = true"
      @canplay="isBuffering = false"
    >
      <track
        v-for="sub in subtitles"
        :key="sub.code"
        kind="subtitles"
        :src="sub.url + (token ? `?token=${token}` : '')"
        :srclang="sub.code"
        :label="sub.label"
      />
      Your browser does not support video playback.
    </video>

    <!-- Buffering Spinner Overlay -->
    <div v-if="isBuffering" class="player-buffering">
      <div class="player-spinner"></div>
    </div>

    <!-- Big Play Button (when paused & not playing) -->
    <div v-if="isPaused && !isBuffering" class="big-play-overlay" @click="togglePlay">
      <div class="big-play-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </div>
    </div>

    <!-- Custom Controls Bar -->
    <div class="player-controls" @click.stop>
      <!-- Progress Bar -->
      <div
        class="progress-bar-container"
        ref="progressBarEl"
        @mousedown="startScrubbing"
        @mousemove="onProgressHover"
        @mouseleave="progressHoverPercent = -1"
      >
        <div class="progress-buffered" :style="{ width: bufferedPercent + '%' }"></div>
        <div class="progress-played" :style="{ width: playedPercent + '%' }"></div>
        <div class="progress-scrubber" :style="{ left: playedPercent + '%' }"></div>
        <!-- Time Preview Tooltip -->
        <div
          v-if="progressHoverPercent >= 0"
          class="progress-tooltip"
          :style="{ left: Math.min(Math.max(progressHoverPercent, 5), 95) + '%' }"
        >
          {{ formatTime((progressHoverPercent / 100) * videoDuration) }}
        </div>
      </div>

      <div class="controls-row">
        <!-- Left Controls -->
        <div class="controls-left">
          <!-- Play / Pause -->
          <button class="ctrl-btn" @click="togglePlay" :title="isPaused ? 'Play (Space)' : 'Pause (Space)'">
            <svg v-if="isPaused" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          </button>

          <!-- Playlist Prev Video -->
          <button
            v-if="hasPrevVideo"
            class="ctrl-btn"
            @click="emit('prev')"
            title="Previous Video"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="4" x2="5" y2="20" stroke="white" stroke-width="2"></line></svg>
          </button>

          <!-- Playlist Next Video -->
          <button
            v-if="hasNextVideo"
            class="ctrl-btn"
            @click="emit('next')"
            title="Next Video"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="4" x2="19" y2="20" stroke="white" stroke-width="2"></line></svg>
          </button>

          <!-- Skip Backward 10s -->
          <button class="ctrl-btn" @click="skip(-10)" title="Rewind 10s (←)">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path><text x="12" y="16" font-size="7" fill="white" stroke="none" text-anchor="middle" font-weight="bold">10</text></svg>
          </button>

          <!-- Skip Forward 10s -->
          <button class="ctrl-btn" @click="skip(10)" title="Forward 10s (→)">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path><text x="12" y="16" font-size="7" fill="white" stroke="none" text-anchor="middle" font-weight="bold">10</text></svg>
          </button>

          <!-- Volume -->
          <div class="volume-control">
            <button class="ctrl-btn" @click="toggleMute" :title="isMuted ? 'Unmute (M)' : 'Mute (M)'">
              <svg v-if="isMuted || currentVolume === 0" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
              <svg v-else-if="currentVolume < 0.5" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            </button>
            <input
              type="range"
              min="0" max="1" step="0.01"
              :value="currentVolume"
              @input="setVolume($event)"
              class="volume-slider"
            />
          </div>

          <!-- Time Display -->
          <span class="time-display">
            {{ formatTime(currentTime) }} / {{ formatTime(videoDuration) }}
          </span>
        </div>

        <!-- Right Controls -->
        <div class="controls-right">
          <!-- Speed Selector -->
          <div class="speed-control" ref="speedMenuRef">
            <button class="ctrl-btn speed-btn" @click="toggleSpeedMenu" title="Playback Speed">
              <span class="speed-label">{{ currentSpeed === 1 ? '1x' : currentSpeed + 'x' }}</span>
            </button>
            <div v-if="showSpeedMenu" class="speed-menu">
              <button
                v-for="speed in playbackSpeeds"
                :key="speed"
                class="speed-option"
                :class="{ active: currentSpeed === speed }"
                @click="setSpeed(speed)"
              >
                {{ speed === 1 ? 'Normal' : speed + 'x' }}
              </button>
            </div>
          </div>

          <!-- Subtitles Selector -->
          <div v-if="subtitles && subtitles.length > 0" class="subtitles-control" ref="subtitlesMenuRef">
            <button
              class="ctrl-btn cc-btn"
              :class="{ active: activeSubtitleCode !== 'off' }"
              @click="toggleSubtitlesMenu"
              title="Subtitles/CC"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect><line x1="7" y1="10" x2="11" y2="10"></line><line x1="7" y1="14" x2="17" y2="14"></line><line x1="15" y1="10" x2="17" y2="10"></line></svg>
            </button>
            <div v-if="showSubtitlesMenu" class="subtitles-menu">
              <button
                class="subtitles-option"
                :class="{ active: activeSubtitleCode === 'off' }"
                @click="selectSubtitle('off')"
              >
                Off
              </button>
              <button
                v-for="sub in subtitles"
                :key="sub.code"
                class="subtitles-option"
                :class="{ active: activeSubtitleCode === sub.code }"
                @click="selectSubtitle(sub.code)"
              >
                {{ sub.label }}
              </button>
            </div>
          </div>

          <!-- Theater Mode -->
          <button class="ctrl-btn" @click="toggleTheaterMode" :title="isTheaterMode ? 'Exit Theater Mode' : 'Theater Mode'">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect></svg>
          </button>

          <!-- Fullscreen -->
          <button class="ctrl-btn" @click="toggleFullscreen" title="Fullscreen (F)">
            <svg v-if="!isFullscreen" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';

const props = defineProps<{
  video: any;
  subtitles: { code: string; label: string; url: string }[];
  token?: string;
  hasPrevVideo?: boolean;
  hasNextVideo?: boolean;
}>();

const emit = defineEmits<{
  ended: [];
  prev: [];
  next: [];
  'theater-mode-change': [boolean];
}>();

const videoPlayer = ref<HTMLVideoElement | null>(null);
const playerContainer = ref<HTMLElement | null>(null);
const progressBarEl = ref<HTMLElement | null>(null);
const speedMenuRef = ref<HTMLElement | null>(null);
const subtitlesMenuRef = ref<HTMLElement | null>(null);

// ============================================
// Custom Player State
// ============================================
const isPaused = ref(true);
const isBuffering = ref(false);
const isMuted = ref(false);
const isFullscreen = ref(false);
const isTheaterMode = ref(false);
const showControls = ref(true);
const currentTime = ref(0);
const videoDuration = ref(0);
const currentVolume = ref(1);
const currentSpeed = ref(1);
const showSpeedMenu = ref(false);
const playedPercent = ref(0);
const bufferedPercent = ref(0);
const progressHoverPercent = ref(-1);
const isScrubbing = ref(false);
let controlsTimeout: ReturnType<typeof setTimeout> | null = null;

const playbackSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Subtitle controls state
const activeSubtitleCode = ref('off');
const showSubtitlesMenu = ref(false);

const toggleSubtitlesMenu = () => {
  showSubtitlesMenu.value = !showSubtitlesMenu.value;
  showSpeedMenu.value = false;
};

const selectSubtitle = (code: string) => {
  activeSubtitleCode.value = code;
  showSubtitlesMenu.value = false;

  const v = videoPlayer.value;
  if (!v) return;

  for (let i = 0; i < v.textTracks.length; i++) {
    const track = v.textTracks[i];
    if (!track) continue;
    if (track.language === code) {
      track.mode = 'showing';
    } else {
      track.mode = 'disabled';
    }
  }
};

// Fires when playback finishes. Keeps player-internal paused state in sync,
// then lets the parent handle playlist/history concerns.
const onEnded = () => {
  isPaused.value = true;
  emit('ended');
};

// ============================================
// Player Controls Logic
// ============================================

const togglePlay = () => {
  const v = videoPlayer.value;
  if (!v) return;
  if (v.paused) {
    v.play();
  } else {
    v.pause();
  }
};

const skip = (seconds: number) => {
  const v = videoPlayer.value;
  if (!v) return;
  v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds));
};

const toggleMute = () => {
  const v = videoPlayer.value;
  if (!v) return;
  v.muted = !v.muted;
  isMuted.value = v.muted;
};

const setVolume = (e: Event) => {
  const v = videoPlayer.value;
  if (!v) return;
  const val = parseFloat((e.target as HTMLInputElement).value);
  v.volume = val;
  currentVolume.value = val;
  if (val > 0 && v.muted) {
    v.muted = false;
    isMuted.value = false;
  }
};

const onVolumeChange = () => {
  const v = videoPlayer.value;
  if (!v) return;
  currentVolume.value = v.volume;
  isMuted.value = v.muted;
};

const onTimeUpdate = () => {
  const v = videoPlayer.value;
  if (!v || isScrubbing.value) return;
  currentTime.value = v.currentTime;
  if (v.duration && !isNaN(v.duration)) {
    videoDuration.value = v.duration;
    playedPercent.value = (v.currentTime / v.duration) * 100;
  }
  // Update buffered
  if (v.buffered.length > 0 && v.duration) {
    bufferedPercent.value = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100;
  }
};

const updateMediaSession = () => {
  if (process.client && 'mediaSession' in navigator && props.video) {
    const v = videoPlayer.value;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: props.video.title || 'YouKeep Video',
      artist: props.video.channel_title || 'YouKeep',
      album: 'YouKeep Archive',
      artwork: [
        {
          src: props.video.local_thumbnail_path || (props.video.id ? `https://i.ytimg.com/vi/${props.video.id}/hqdefault.jpg` : ''),
          sizes: '512x512',
          type: 'image/jpeg'
        }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => {
      if (v) v.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (v) v.pause();
    });
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      skip(-10);
    });
    navigator.mediaSession.setActionHandler('seekforward', () => {
      skip(10);
    });
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (v && details.seekTime !== undefined) {
          v.currentTime = details.seekTime;
        }
      });
    } catch (e) {}
  }
};

const onPlayTrigger = () => {
  isPaused.value = false;
  updateMediaSession();
};

const onPauseTrigger = () => {
  isPaused.value = true;
};

const onMetadataLoaded = () => {
  const v = videoPlayer.value;
  if (!v) return;
  if (v.duration && !isNaN(v.duration)) {
    videoDuration.value = v.duration;
  }
  // Autoplay
  v.play().catch(() => {
    isPaused.value = true;
  });
  updateMediaSession();
};

const onDurationChange = () => {
  const v = videoPlayer.value;
  if (!v) return;
  if (v.duration && !isNaN(v.duration)) {
    videoDuration.value = v.duration;
  }
};

const setSpeed = (speed: number) => {
  const v = videoPlayer.value;
  if (!v) return;
  v.playbackRate = speed;
  currentSpeed.value = speed;
  showSpeedMenu.value = false;
};

const toggleSpeedMenu = () => {
  showSpeedMenu.value = !showSpeedMenu.value;
};

const toggleFullscreen = () => {
  const container = playerContainer.value;
  if (!container) return;

  if (!document.fullscreenElement) {
    container.requestFullscreen().then(() => {
      isFullscreen.value = true;
    }).catch(() => {});
  } else {
    document.exitFullscreen().then(() => {
      isFullscreen.value = false;
    }).catch(() => {});
  }
};

const toggleTheaterMode = () => {
  isTheaterMode.value = !isTheaterMode.value;
  emit('theater-mode-change', isTheaterMode.value);
};

// Progress Bar Scrubbing
const startScrubbing = (e: MouseEvent) => {
  isScrubbing.value = true;
  scrubTo(e);
  document.addEventListener('mousemove', scrubTo);
  document.addEventListener('mouseup', stopScrubbing);
};

const scrubTo = (e: MouseEvent) => {
  const bar = progressBarEl.value;
  if (!bar || !videoPlayer.value) return;
  const rect = bar.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  playedPercent.value = percent * 100;
  currentTime.value = percent * videoDuration.value;
};

const stopScrubbing = (e: MouseEvent) => {
  isScrubbing.value = false;
  document.removeEventListener('mousemove', scrubTo);
  document.removeEventListener('mouseup', stopScrubbing);

  const bar = progressBarEl.value;
  if (!bar || !videoPlayer.value) return;
  const rect = bar.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  videoPlayer.value.currentTime = percent * videoDuration.value;
};

const onProgressHover = (e: MouseEvent) => {
  const bar = progressBarEl.value;
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  progressHoverPercent.value = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
};

// Controls auto-hide
const handleMouseMove = () => {
  showControls.value = true;
  resetControlsTimeout();
};

const handleMouseLeave = () => {
  if (!isPaused.value) {
    controlsTimeout = setTimeout(() => {
      showControls.value = false;
    }, 2000);
  }
};

const resetControlsTimeout = () => {
  if (controlsTimeout) clearTimeout(controlsTimeout);
  if (!isPaused.value) {
    controlsTimeout = setTimeout(() => {
      showControls.value = false;
    }, 3000);
  }
};

// Keyboard Shortcuts
const handleKeydown = (e: KeyboardEvent) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  switch (e.key) {
    case ' ':
    case 'k':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      skip(-10);
      break;
    case 'ArrowRight':
      e.preventDefault();
      skip(10);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (videoPlayer.value) {
        videoPlayer.value.volume = Math.min(1, videoPlayer.value.volume + 0.1);
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (videoPlayer.value) {
        videoPlayer.value.volume = Math.max(0, videoPlayer.value.volume - 0.1);
      }
      break;
    case 'f':
    case 'F':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'm':
    case 'M':
      e.preventDefault();
      toggleMute();
      break;
  }
};

// Listen to fullscreen change events
const onFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement;
};

// Close speed and subtitles menu on outside click
const onDocumentClick = (e: MouseEvent) => {
  if (speedMenuRef.value && !speedMenuRef.value.contains(e.target as Node)) {
    showSpeedMenu.value = false;
  }
  if (subtitlesMenuRef.value && !subtitlesMenuRef.value.contains(e.target as Node)) {
    showSubtitlesMenu.value = false;
  }
};

const wasPlayingBeforeVisibilityChange = ref(false);

const handleVisibilityChange = () => {
  const v = videoPlayer.value;
  if (!v) return;

  if (document.hidden) {
    wasPlayingBeforeVisibilityChange.value = !v.paused;
    if (wasPlayingBeforeVisibilityChange.value) {
      // In background: wait a moment and try to resume if browser auto-paused it.
      setTimeout(() => {
        if (v.paused) {
          v.play().catch(err => {
            console.log('Background play request failed:', err);
          });
        }
      }, 200);
    }
  } else {
    // Returned to foreground
    if (wasPlayingBeforeVisibilityChange.value && v.paused) {
      v.play().catch(() => {});
    }
  }
};

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('click', onDocumentClick);
  if (process.client) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // Focus player container for keyboard shortcuts
  nextTick(() => {
    playerContainer.value?.focus();
  });
});

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('click', onDocumentClick);
  if (process.client) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (controlsTimeout) clearTimeout(controlsTimeout);
});

// Reload video source when the video changes
watch(() => props.video?.id, () => {
  currentTime.value = 0;
  playedPercent.value = 0;
  currentSpeed.value = 1;
  if (videoPlayer.value) {
    videoPlayer.value.playbackRate = 1;
    videoPlayer.value.load();
  }
});

/* Format Helpers */
const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

defineExpose({ videoEl: videoPlayer });
</script>

<style scoped>
/* ============================================
   CUSTOM VIDEO PLAYER
   ============================================ */
.video-player-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  background: #000;
  box-shadow: 0 0 80px rgba(139, 92, 246, 0.15), var(--shadow-lg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  outline: none;
  user-select: none;
}

.video-player-container:focus {
  border-color: rgba(139, 92, 246, 0.3);
}

.video-player-container.is-short-player {
  aspect-ratio: 9/16 !important;
  max-width: 450px;
  margin: 0 auto;
}

.video-player {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Hide native controls */
.video-player::-webkit-media-controls {
  display: none !important;
}

/* Buffering Spinner */
.player-buffering {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  z-index: 5;
}

.player-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

/* Big Play Overlay */
.big-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4;
  background: rgba(0, 0, 0, 0.15);
}

.big-play-btn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  border: 2px solid rgba(255, 255, 255, 0.15);
}

.big-play-btn svg {
  margin-left: 4px;
}

.big-play-btn:hover {
  background: rgba(139, 92, 246, 0.5);
  transform: scale(1.1);
  border-color: rgba(139, 92, 246, 0.5);
  box-shadow: 0 0 30px var(--accent-primary-glow);
}

/* Player Controls Bar */
.player-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
  padding: 32px 12px 10px 12px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.25s ease;
  cursor: default;
}

.controls-visible .player-controls {
  opacity: 1;
}

/* Progress Bar */
.progress-bar-container {
  position: relative;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  cursor: pointer;
  margin-bottom: 8px;
  /* impeccable-disable layout-transition */ transition: height var(--duration-fast) var(--ease-standard);
}

.progress-bar-container:hover {
  height: 6px;
}

.progress-buffered {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  pointer-events: none;
}

.progress-played {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
  border-radius: 2px;
  pointer-events: none;
}

.progress-scrubber {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  transform: translate(-50%, -50%);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.progress-bar-container:hover .progress-scrubber {
  opacity: 1;
}

.progress-tooltip {
  position: absolute;
  bottom: 18px;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

/* Controls Row */
.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4) var(--space-3);
}

.controls-left, .controls-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.ctrl-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 50%;
  transition: background-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  color: white;
  flex-shrink: 0;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

/* Volume Control */
.volume-control {
  display: flex;
  align-items: center;
  gap: 0;
}

.volume-slider {
  width: 0;
  opacity: 0;
  transition: width 0.2s ease, opacity 0.2s ease;
  accent-color: var(--accent-primary);
  cursor: pointer;
  height: 4px;
}

.volume-control:hover .volume-slider {
  width: 80px;
  opacity: 1;
  margin-left: 4px;
}

/* Time Display */
.time-display {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-left: 8px;
  font-weight: 500;
}

/* Speed Control */
.speed-control {
  position: relative;
}

.speed-btn {
  width: auto;
  padding: 0 10px;
  border-radius: 6px;
}

.speed-label {
  font-size: 13px;
  font-weight: 700;
  color: white;
}

.speed-menu {
  position: absolute;
  bottom: 44px;
  right: 0;
  background: rgba(20, 20, 35, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--border-radius-sm);
  padding: 6px 0;
  min-width: 120px;
  box-shadow: var(--shadow-lg);
  animation: fadeIn 0.15s ease-out;
}

.speed-option {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  background: none;
  border: none;
  transition: all 0.15s;
}

.speed-option:hover {
  background: rgba(139, 92, 246, 0.1);
  color: white;
}

.speed-option.active {
  color: var(--accent-primary-hover);
  font-weight: 700;
  background: rgba(139, 92, 246, 0.08);
}

.subtitles-control {
  position: relative;
}

.subtitles-menu {
  position: absolute;
  bottom: 44px;
  right: 0;
  background: rgba(20, 20, 35, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--border-radius-sm);
  padding: 6px 0;
  min-width: 120px;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: fadeIn 0.15s ease-out;
}

.subtitles-option {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  background: none;
  border: none;
  transition: all 0.15s;
}

.subtitles-option:hover {
  background: rgba(139, 92, 246, 0.1);
  color: white;
}

.subtitles-option.active {
  color: var(--accent-primary-hover);
  font-weight: 700;
  background: rgba(139, 92, 246, 0.08);
}

.ctrl-btn.cc-btn.active svg {
  color: var(--accent-primary-hover);
  filter: drop-shadow(0 0 5px var(--accent-primary-glow));
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
