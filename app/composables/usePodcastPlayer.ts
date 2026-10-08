import { useActiveMiniPlayer } from './useActiveMiniPlayer';
import { useAuth } from './useAuth';
import { usePodcastProgress } from './usePodcastProgress';
import { chooseResumePosition, reachesEnd } from '#shared/podcastProgress';
import type { EpisodeProgress, LocalPosition } from '#shared/podcastProgress';

export interface PlayableEpisode {
  id: string;
  title: string;
  show_title?: string;
  show_cover_url?: string | null;
  duration?: number | null;
  local_file_path: string;
}

const STORAGE_KEY = 'podcast_player_state';

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SKIP_BACK_SECONDS = 15;
export const SKIP_FORWARD_SECONDS = 30;
// Minimum gap between two progress syncs while playing (pause, end, episode
// change and page hide always sync at once).
export const PROGRESS_SYNC_INTERVAL_MS = 15000;

// Bumped by every load and seek: a server position that arrives late is only
// applied when nothing moved the playhead in the meantime.
let positionSeq = 0;

// Pure. Podcast episodes routinely run past an hour, so this renders H:MM:SS
// above 3600s and M:SS below it. Every component is floored because the value
// usually comes from audio.currentTime, which is a float.
export function formatPodcastTime(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Pure. durationSeconds <= 0 means "unknown duration" (metadata not loaded
// yet), in which case only the lower bound is enforced.
export function clampSeekTime(seconds: number, durationSeconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const lower = Math.max(0, seconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return lower;
  return Math.min(lower, durationSeconds);
}

// Pure. A held position within toleranceSeconds of the known duration is
// treated as "the episode finished", so replaying it restarts from 0 instead
// of seeking to (near) the very end. durationSeconds <= 0 means unknown
// duration, in which case nothing is considered finished (mirrors
// clampSeekTime's "unknown duration" convention).
export function isFinishedPosition(
  positionSeconds: number,
  durationSeconds: number,
  toleranceSeconds = 2
): boolean {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }
  return positionSeconds >= durationSeconds - toleranceSeconds;
}

function isValidStoredEpisode(value: any): value is PlayableEpisode {
  return (
    !!value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.title === 'string' &&
    typeof value.local_file_path === 'string' &&
    value.local_file_path.length > 0
  );
}

export function usePodcastPlayer() {
  const currentEpisode = useState<PlayableEpisode | null>('podcast_player_current_episode', () => null);
  const isPlaying = useState<boolean>('podcast_player_is_playing', () => false);
  const currentTime = useState<number>('podcast_player_current_time', () => 0);
  const duration = useState<number>('podcast_player_duration', () => 0);
  const playbackRate = useState<number>('podcast_player_rate', () => 1);
  const audioEl = useState<HTMLMediaElement | null>('podcast_player_audio_el', () => null);
  const lastPlayedAt = useState<number>('podcast_player_last_played_at', () => 0);
  // When the local position was last written to localStorage, to compare it
  // with the server position (the newer one wins on play/restore).
  const localSavedAt = useState<number>('podcast_player_saved_at', () => 0);
  const lastSyncAt = useState<number>('podcast_player_last_sync_at', () => 0);
  const { user } = useAuth();
  const progressStore = usePodcastProgress();

  // Effective duration: the element's reported duration once metadata has
  // loaded, otherwise the RSS-provided duration from podcast_episodes.
  function effectiveDuration(): number {
    return duration.value || currentEpisode.value?.duration || 0;
  }

  // isRestore marks a load triggered by restoreFromLocalStorage() (i.e. one
  // the user never asked for) rather than a real play() action. It arms an
  // error listener that treats a load failure as "the restored episode is
  // stale" and clears the saved state, so a since-deleted file doesn't keep
  // producing an unsolicited error toast on every future page load. A live
  // playback error (network blip mid-listen, handled by
  // PodcastMiniPlayer.vue's own @error listener) never goes through this
  // path and never wipes localStorage.
  function loadEpisode(episode: PlayableEpisode, startAt: number, isRestore = false) {
    positionSeq++;
    currentEpisode.value = episode;
    currentTime.value = startAt;
    duration.value = 0;

    const el = audioEl.value;
    if (!el) return;

    el.src = episode.local_file_path;
    el.playbackRate = playbackRate.value;

    if (isRestore) {
      const onRestoreError = () => {
        el.removeEventListener('loadedmetadata', onRestoreSuccess);
        el.removeEventListener('error', onRestoreError);
        // Only clear state if this failure still belongs to the episode we
        // restored (a later real play() call may have already replaced it).
        if (currentEpisode.value?.id !== episode.id) return;
        if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
        currentEpisode.value = null;
        currentTime.value = 0;
        duration.value = 0;
        isPlaying.value = false;
      };
      const onRestoreSuccess = () => {
        el.removeEventListener('loadedmetadata', onRestoreSuccess);
        el.removeEventListener('error', onRestoreError);
      };
      el.addEventListener('error', onRestoreError);
      el.addEventListener('loadedmetadata', onRestoreSuccess);
    }

    if (startAt <= 0) {
      el.currentTime = 0;
      return;
    }

    // Assigning .src resets currentTime to 0 and the new position cannot be
    // set until the element knows the media's length, so defer to
    // loadedmetadata. Same listener-cleanup shape as useMusicPlayer.ts.
    const apply = () => {
      cleanup();
      if (currentEpisode.value?.id !== episode.id) return;
      el.currentTime = startAt;
      currentTime.value = startAt;
    };
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', apply);
      el.removeEventListener('error', cleanup);
    };
    el.addEventListener('loadedmetadata', apply);
    el.addEventListener('error', cleanup);
  }

  // Moves the playhead of the loaded `episode` to a position that arrived
  // after the load (the server one), waiting for metadata when needed.
  function applyLatePosition(episode: PlayableEpisode, target: number) {
    const el = audioEl.value;
    if (!el || currentEpisode.value?.id !== episode.id) return;
    const apply = () => {
      if (currentEpisode.value?.id !== episode.id) return;
      el.currentTime = target;
      currentTime.value = target;
    };
    currentTime.value = target;
    if ((el as any).readyState >= 1) {
      apply();
      return;
    }
    const onMeta = () => {
      el.removeEventListener('loadedmetadata', onMeta);
      apply();
    };
    el.addEventListener('loadedmetadata', onMeta);
  }

  // For a logged-in user, looks the server position up (unless already
  // cached) and moves to it when it is newer than `local` and nothing moved
  // the playhead since the load.
  function reconcileWithServer(episode: PlayableEpisode, local: LocalPosition | null, startedAt: number, onlyWhilePaused = false) {
    if (!user.value) return;
    const seq = positionSeq;
    progressStore.lookup(episode.id).then((server) => {
      if (!server || seq !== positionSeq || currentEpisode.value?.id !== episode.id) return;
      if (onlyWhilePaused && isPlaying.value) return;
      const target = chooseResumePosition(local, server, episode.duration);
      if (Math.abs(target - startedAt) >= 1) applyLatePosition(episode, target);
    });
  }

  function play(episode: PlayableEpisode) {
    // Activation happens here and nowhere else — see the matching comment in
    // useMusicPlayer.ts's play().
    useActiveMiniPlayer().setActive('podcast');
    lastPlayedAt.value = Date.now();

    // Leaving another episode: record where it was left first.
    if (currentEpisode.value && currentEpisode.value.id !== episode.id) {
      syncProgress({ force: true });
    }

    // Replaying the episode already loaded picks up where it left off (that
    // is what makes the restored "resume" state resume) — UNLESS that held
    // position is at (or within a couple seconds of) the episode's end, in
    // which case it already finished and should restart from 0 instead of
    // seeking straight back to the end. Any other episode starts from the
    // beginning, unless the server knows a position (logged-in users): the
    // server position is used when it is newer than the local one.
    const local: LocalPosition | null = currentEpisode.value?.id === episode.id
      ? {
          positionSeconds: isFinishedPosition(currentTime.value, effectiveDuration()) ? 0 : currentTime.value,
          savedAt: localSavedAt.value,
        }
      : null;
    const cached: EpisodeProgress | null | undefined = user.value && progressStore.isKnown(episode.id)
      ? progressStore.get(episode.id)
      : undefined;
    const resumeAt = cached !== undefined
      ? chooseResumePosition(local, cached, episode.duration)
      : (local?.positionSeconds ?? 0);
    loadEpisode(episode, resumeAt);
    const el = audioEl.value;
    if (el) {
      el.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
    if (cached === undefined) reconcileWithServer(episode, local, resumeAt);
    // Flush immediately — same reason as useMusicPlayer.ts's play().
    saveToLocalStorage();
  }

  function togglePlay() {
    if (!audioEl.value || !currentEpisode.value) return;
    if (isPlaying.value) {
      audioEl.value.pause();
      isPlaying.value = false;
    } else {
      lastPlayedAt.value = Date.now();
      audioEl.value.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
  }

  function seek(seconds: number) {
    if (!audioEl.value) return;
    const target = clampSeekTime(seconds, effectiveDuration());
    positionSeq++;
    audioEl.value.currentTime = target;
    currentTime.value = target;
  }

  function skipBack() {
    seek(currentTime.value - SKIP_BACK_SECONDS);
  }

  function skipForward() {
    seek(currentTime.value + SKIP_FORWARD_SECONDS);
  }

  function setPlaybackRate(rate: number) {
    if (!(PLAYBACK_RATES as readonly number[]).includes(rate)) return;
    playbackRate.value = rate;
    if (audioEl.value) audioEl.value.playbackRate = rate;
    saveToLocalStorage();
  }

  function saveToLocalStorage() {
    if (typeof window === 'undefined' || !currentEpisode.value) return;
    localSavedAt.value = Date.now();
    const state = {
      episode: currentEpisode.value,
      currentTime: currentTime.value,
      playbackRate: playbackRate.value,
      lastPlayedAt: lastPlayedAt.value,
      savedAt: localSavedAt.value,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // Sends the current position to the server for a logged-in user, at most
  // once per PROGRESS_SYNC_INTERVAL_MS unless `force`. `completed` marks the
  // end of the episode. `keepalive` is for page hide: the request must
  // outlive the page, so it goes through window.fetch (patched by
  // csrf.client.ts to carry the CSRF header) with keepalive set.
  function syncProgress(opts: { force?: boolean; completed?: boolean; keepalive?: boolean } = {}) {
    const episode = currentEpisode.value;
    if (!episode || !user.value || typeof window === 'undefined') return;
    const now = Date.now();
    if (!opts.force && now - lastSyncAt.value < PROGRESS_SYNC_INTERVAL_MS) return;
    const positionSeconds = Math.floor(currentTime.value);
    if (positionSeconds <= 0 && !opts.completed) return;
    lastSyncAt.value = now;

    const durationSeconds = Math.round(effectiveDuration()) || null;
    const body: Record<string, unknown> = { positionSeconds };
    if (durationSeconds) body.durationSeconds = durationSeconds;
    if (opts.completed) body.completed = true;

    // Progress bars follow along at once.
    const previous = progressStore.get(episode.id);
    progressStore.record(episode.id, {
      positionSeconds: durationSeconds ? Math.min(positionSeconds, durationSeconds) : positionSeconds,
      durationSeconds,
      completed: !!opts.completed || !!previous?.completed || reachesEnd(positionSeconds, durationSeconds),
      updatedAt: now,
    });

    const url = `/api/podcasts/episodes/${encodeURIComponent(episode.id)}/progress`;
    if (opts.keepalive) {
      window.fetch(url, {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
      return;
    }
    $fetch<EpisodeProgress>(url, { method: 'PUT', body })
      .then((saved) => { if (saved) progressStore.record(episode.id, saved); })
      .catch(() => {});
  }

  // No server call for the episode itself: the whole PlayableEpisode is
  // stored client-side, since podcasts have no by-ids rehydration endpoint.
  // Only the position may be replaced by a newer server one (logged-in
  // users). Never auto-plays — it only primes the mini-player.
  function restoreFromLocalStorage() {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let saved: any;
    try {
      saved = JSON.parse(raw);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    if (!saved || !isValidStoredEpisode(saved.episode)) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    playbackRate.value = (PLAYBACK_RATES as readonly number[]).includes(saved.playbackRate)
      ? saved.playbackRate
      : 1;
    isPlaying.value = false;
    lastPlayedAt.value = typeof saved.lastPlayedAt === 'number' && Number.isFinite(saved.lastPlayedAt)
      ? saved.lastPlayedAt
      : 0;
    localSavedAt.value = typeof saved.savedAt === 'number' && Number.isFinite(saved.savedAt) ? saved.savedAt : 0;

    const restoreTime =
      typeof saved.currentTime === 'number' && Number.isFinite(saved.currentTime) && saved.currentTime > 0
        ? saved.currentTime
        : 0;
    loadEpisode(saved.episode, restoreTime, true);
    reconcileWithServer(saved.episode, { positionSeconds: restoreTime, savedAt: localSavedAt.value }, restoreTime, true);
  }

  return {
    currentEpisode, isPlaying, currentTime, duration, playbackRate, audioEl, lastPlayedAt,
    play, togglePlay, seek, skipBack, skipForward, setPlaybackRate,
    saveToLocalStorage, restoreFromLocalStorage, syncProgress,
  };
}
