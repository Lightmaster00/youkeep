import { watch, onBeforeUnmount, onMounted, type Ref } from 'vue';
import { getResumePosition, saveResumePosition, resumeTarget } from '~/utils/videoResume';

// The watch page's playback bookkeeping:
// - watch time for signed-in users (POST /api/videos/track): actual playback
//   only, sent every 15 s of it and on pause/leave, at most 600 s per call
//   (the server clamps there anyway); guests post nothing;
// - resume: signed-in users send the position with every watch-time post (and
//   on pause/end, even without new watch time) and resume from the server
//   position; the position is also kept per video in localStorage (the only
//   source for guests). A link that asks for a start time (?t=) wins.
export const TRACK_FLUSH_SECONDS = 15;
export const TRACK_MAX_PER_CALL = 600;
const SAVE_EVERY_MS = 5000;
// A gap longer than this between two timeupdates is not continuous playback
// (tab asleep, debugger, ...).
const MAX_TICK_MS = 2500;

export function useVideoWatchProgress(opts: {
  videoEl: () => HTMLVideoElement | null | undefined;
  videoId: Ref<string>;
  isLoggedIn: Ref<boolean>;
  startAt: Ref<number | null>;
  /** The signed-in viewer's stored position (GET /api/videos/:id), or null. */
  serverPosition?: Ref<number | null>;
}) {
  let el: HTMLVideoElement | null = null;
  let accumulated = 0;
  let accumulatedFor = '';
  let lastTick: number | null = null;
  let lastSave = 0;
  let positioned = '';

  // The playing video's position, only while `videoId` is what the element plays.
  function positionOf(videoId: string, atEnd = false): { positionSeconds: number; durationSeconds?: number } | null {
    if (!el || videoId !== opts.videoId.value) return null;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : undefined;
    const time = atEnd && duration ? duration : el.currentTime;
    if (!Number.isFinite(time) || time < 0) return null;
    return { positionSeconds: Math.floor(time), ...(duration ? { durationSeconds: duration } : {}) };
  }

  // `positionOnly`: send the position even without new watch time (pause, end, leave).
  function flush(keepalive = false, positionOnly = false, atEnd = false) {
    const videoId = accumulatedFor || (positionOnly ? opts.videoId.value : '');
    const seconds = Math.min(TRACK_MAX_PER_CALL, Math.round(accumulated));
    accumulated = 0;
    if (!videoId || !opts.isLoggedIn.value) return;
    const position = positionOf(videoId, atEnd);
    if (seconds <= 0 && !(positionOnly && position)) return;
    $fetch('/api/videos/track', {
      method: 'POST',
      body: { videoId, watchTimeSeconds: Math.max(0, seconds), ...(position ?? {}) },
      ...(keepalive ? { keepalive: true } : {}),
    }).catch(() => {});
  }

  function savePosition(force = false) {
    if (!el || !opts.videoId.value) return;
    const now = Date.now();
    if (!force && now - lastSave < SAVE_EVERY_MS) return;
    lastSave = now;
    saveResumePosition(opts.videoId.value, el.currentTime, el.duration || 0);
  }

  function applyStartPosition() {
    if (!el || positioned === opts.videoId.value || !(el.duration > 0)) return;
    positioned = opts.videoId.value;
    const start = opts.startAt.value;
    if (start !== null) {
      el.currentTime = Math.min(start, el.duration);
      return;
    }
    const server = opts.isLoggedIn.value ? opts.serverPosition?.value ?? null : null;
    const target = resumeTarget(server ?? getResumePosition(opts.videoId.value), el.duration);
    if (target !== null) el.currentTime = target;
  }

  function onTimeUpdate() {
    if (!el) return;
    if (!el.paused) {
      const now = Date.now();
      if (lastTick !== null) {
        const delta = now - lastTick;
        if (delta > 0 && delta <= MAX_TICK_MS) {
          if (accumulatedFor !== opts.videoId.value) {
            flush();
            accumulatedFor = opts.videoId.value;
          }
          accumulated += delta / 1000;
          if (accumulated >= TRACK_FLUSH_SECONDS) flush();
        }
      }
      lastTick = now;
    }
    savePosition();
  }

  function onPause() {
    lastTick = null;
    flush(false, true);
    savePosition(true);
  }

  function onEnded() {
    lastTick = null;
    flush(false, true, true);
    if (opts.videoId.value) saveResumePosition(opts.videoId.value, Number.POSITIVE_INFINITY, el?.duration || 0);
  }

  function onPlay() {
    lastTick = Date.now();
  }

  function attach(next: HTMLVideoElement | null | undefined) {
    if (el === next) return;
    detach();
    el = next || null;
    if (!el) return;
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('play', onPlay);
    el.addEventListener('loadedmetadata', applyStartPosition);
    applyStartPosition();
  }

  function detach() {
    if (!el) return;
    el.removeEventListener('timeupdate', onTimeUpdate);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('ended', onEnded);
    el.removeEventListener('play', onPlay);
    el.removeEventListener('loadedmetadata', applyStartPosition);
    el = null;
  }

  function onPageHide() {
    flush(true, true);
    savePosition(true);
  }

  onMounted(() => {
    watch(opts.videoEl, attach, { immediate: true });
    window.addEventListener('pagehide', onPageHide);
  });

  // Another video in the same player: send what the previous one earned.
  watch(opts.videoId, () => {
    flush();
    lastTick = null;
    lastSave = 0;
  });

  onBeforeUnmount(() => {
    if (el && opts.videoId.value) saveResumePosition(opts.videoId.value, el.currentTime, el.duration || 0);
    flush(true, true);
    detach();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
  });

  return { flush };
}
