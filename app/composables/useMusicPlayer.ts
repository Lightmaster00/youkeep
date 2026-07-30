export interface PlayableTrack {
  id: string;
  title: string;
  artist_name?: string;
  track_number?: number | null;
  genre?: string | null;
  language?: string | null;
  duration?: number | null;
  local_file_path: string;
  local_thumbnail_path?: string | null;
}

const STORAGE_KEY = 'music_player_state';

export function useMusicPlayer() {
  const currentTrack = useState<PlayableTrack | null>('music_player_current_track', () => null);
  const queue = useState<PlayableTrack[]>('music_player_queue', () => []);
  const currentIndex = useState<number>('music_player_current_index', () => -1);
  const isPlaying = useState<boolean>('music_player_is_playing', () => false);
  const currentTime = useState<number>('music_player_current_time', () => 0);
  const duration = useState<number>('music_player_duration', () => 0);
  const audioEl = useState<HTMLAudioElement | null>('music_player_audio_el', () => null);
  const shuffleOn = useState<boolean>('music_player_shuffle', () => false);
  const repeatMode = useState<'off' | 'all' | 'one'>('music_player_repeat', () => 'off');
  const shuffledOrder = useState<number[] | null>('music_player_shuffled_order', () => null);
  const hasCountedThisPlay = useState<boolean>('music_player_has_counted', () => false);

  function loadTrack(track: PlayableTrack, index: number) {
    currentTrack.value = track;
    currentIndex.value = index;
    hasCountedThisPlay.value = false;
    currentTime.value = 0;
    duration.value = 0;
    if (audioEl.value) {
      audioEl.value.src = track.local_file_path;
      audioEl.value.currentTime = 0;
    }
  }

  function generateShuffledOrder(fromIndex?: number) {
    const indices = queue.value.map((_, i) => i).filter((i) => i !== fromIndex);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = indices[i]!;
      indices[i] = indices[j]!;
      indices[j] = tmp;
    }
    shuffledOrder.value = fromIndex !== undefined ? [fromIndex, ...indices] : indices;
  }

  function play(track: PlayableTrack, tracks: PlayableTrack[]) {
    const idx = tracks.findIndex((t) => t.id === track.id);
    if (idx === -1) {
      queue.value = [track, ...tracks];
      loadTrack(track, 0);
    } else {
      queue.value = tracks;
      loadTrack(track, idx);
    }
    if (shuffleOn.value) {
      generateShuffledOrder(currentIndex.value);
    }
    if (audioEl.value) {
      audioEl.value.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
  }

  function togglePlay() {
    if (!audioEl.value || !currentTrack.value) return;
    if (isPlaying.value) {
      audioEl.value.pause();
      isPlaying.value = false;
    } else {
      audioEl.value.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
  }

  function seek(seconds: number) {
    if (!audioEl.value) return;
    audioEl.value.currentTime = seconds;
    currentTime.value = seconds;
  }

  function toggleShuffle() {
    shuffleOn.value = !shuffleOn.value;
    if (shuffleOn.value) {
      generateShuffledOrder(currentIndex.value);
    } else {
      shuffledOrder.value = null;
    }
  }

  function cycleRepeat() {
    repeatMode.value = repeatMode.value === 'off' ? 'all' : repeatMode.value === 'all' ? 'one' : 'off';
  }

  function nextIndex(): number | null {
    if (queue.value.length === 0) return null;
    if (repeatMode.value === 'one') return currentIndex.value;

    if (shuffleOn.value && shuffledOrder.value) {
      const posInShuffled = shuffledOrder.value.indexOf(currentIndex.value);
      const nextPos = posInShuffled + 1;
      if (nextPos < shuffledOrder.value.length) return shuffledOrder.value[nextPos]!;
      if (repeatMode.value === 'all') {
        generateShuffledOrder();
        return shuffledOrder.value![0]!;
      }
      return null;
    }

    const next = currentIndex.value + 1;
    if (next < queue.value.length) return next;
    if (repeatMode.value === 'all') return 0;
    return null;
  }

  function prevIndex(): number | null {
    if (queue.value.length === 0) return null;
    if (shuffleOn.value && shuffledOrder.value) {
      const posInShuffled = shuffledOrder.value.indexOf(currentIndex.value);
      const prevPos = posInShuffled - 1;
      if (prevPos >= 0) return shuffledOrder.value[prevPos]!;
      if (repeatMode.value === 'all') return shuffledOrder.value[shuffledOrder.value.length - 1]!;
      return null;
    }
    const prev = currentIndex.value - 1;
    if (prev >= 0) return prev;
    if (repeatMode.value === 'all') return queue.value.length - 1;
    return null;
  }

  function next() {
    const idx = nextIndex();
    if (idx === null) {
      audioEl.value?.pause();
      isPlaying.value = false;
      return;
    }
    const track = queue.value[idx];
    if (!track) return;
    loadTrack(track, idx);
    if (audioEl.value) {
      audioEl.value.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
  }

  function prev() {
    const idx = prevIndex();
    if (idx === null) {
      audioEl.value?.pause();
      isPlaying.value = false;
      return;
    }
    const track = queue.value[idx];
    if (!track) return;
    loadTrack(track, idx);
    if (audioEl.value) {
      audioEl.value.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
  }

  function recordPlayIfThresholdReached() {
    if (hasCountedThisPlay.value || !currentTrack.value) return;
    const dur = duration.value || currentTrack.value.duration || 0;
    if (dur <= 0) return;
    const threshold = Math.min(30, dur * 0.5);
    if (currentTime.value >= threshold) {
      hasCountedThisPlay.value = true;
      $fetch(`/api/music/tracks/${currentTrack.value.id}/play`, { method: 'POST' }).catch(() => {});
    }
  }

  function saveToLocalStorage() {
    if (typeof window === 'undefined' || !currentTrack.value) return;
    const state = {
      trackId: currentTrack.value.id,
      queueTrackIds: queue.value.map((t) => t.id),
      currentIndex: currentIndex.value,
      currentTime: currentTime.value,
      shuffleOn: shuffleOn.value,
      repeatMode: repeatMode.value,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  async function restoreFromLocalStorage() {
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
    if (!saved || !Array.isArray(saved.queueTrackIds) || saved.queueTrackIds.length === 0) return;

    try {
      const data = await $fetch<{ tracks: PlayableTrack[] }>('/api/music/tracks/by-ids', {
        method: 'POST',
        body: { ids: saved.queueTrackIds }
      });
      const restoredQueue = data.tracks || [];
      if (restoredQueue.length === 0) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }

      const idx = restoredQueue.findIndex((t) => t.id === saved.trackId);
      queue.value = restoredQueue;
      currentIndex.value = idx === -1 ? 0 : idx;
      currentTrack.value = restoredQueue[currentIndex.value] ?? null;
      shuffleOn.value = !!saved.shuffleOn;
      repeatMode.value = ['off', 'all', 'one'].includes(saved.repeatMode) ? saved.repeatMode : 'off';
      if (shuffleOn.value) generateShuffledOrder(currentIndex.value);
      hasCountedThisPlay.value = false;
      isPlaying.value = false;

      if (audioEl.value && currentTrack.value) {
        const el = audioEl.value;
        const track = currentTrack.value;
        el.src = track.local_file_path;
        const restoreTime = typeof saved.currentTime === 'number' ? saved.currentTime : 0;
        const setTime = () => {
          cleanup();
          if (currentTrack.value?.id !== track.id) return;
          el.currentTime = restoreTime;
          currentTime.value = restoreTime;
        };
        const cleanup = () => {
          el.removeEventListener('loadedmetadata', setTime);
          el.removeEventListener('error', cleanup);
        };
        el.addEventListener('loadedmetadata', setTime);
        el.addEventListener('error', cleanup);
      }
    } catch (e) {
      // Restore is best-effort — a failed fetch just leaves nothing playing.
    }
  }

  return {
    currentTrack, queue, currentIndex, isPlaying, currentTime, duration, audioEl,
    shuffleOn, repeatMode,
    play, togglePlay, seek, next, prev, toggleShuffle, cycleRepeat,
    recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
  };
}
