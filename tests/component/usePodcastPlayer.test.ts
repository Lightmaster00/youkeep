import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { defineComponent, h } from 'vue';
import {
  usePodcastPlayer,
  formatPodcastTime,
  clampSeekTime,
  isFinishedPosition,
  PLAYBACK_RATES,
  SKIP_BACK_SECONDS,
  SKIP_FORWARD_SECONDS,
  type PlayableEpisode
} from '../../app/composables/usePodcastPlayer';
import { useActiveMiniPlayer } from '../../app/composables/useActiveMiniPlayer';

// usePodcastPlayer() is built on Nuxt's useState(), which is a singleton keyed
// by string and SHARED across every it() block in this file (@nuxt/test-utils
// reuses one Nuxt app per test file). Every test below sets the full state it
// needs up front rather than relying on the composable's initial values, which
// only apply the first time a key is touched. Mirrors
// tests/component/useMusicPlayer.test.ts.

const STORAGE_KEY = 'podcast_player_state';
const ACTIVE_KEY = 'active_mini_player_type';

function episode(id: string, extra: Partial<PlayableEpisode> = {}): PlayableEpisode {
  return {
    id,
    title: `Episode ${id}`,
    show_title: 'A Show',
    show_cover_url: null,
    duration: 3600,
    local_file_path: `/downloads-podcasts/a-show/${id}.mp3`,
    ...extra
  };
}

interface FakeAudio {
  src: string;
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  listeners: Record<string, Array<() => void>>;
  fire(type: string): void;
}

function fakeAudio(): FakeAudio {
  const listeners: Record<string, Array<() => void>> = {};
  const el: FakeAudio = {
    src: '',
    currentTime: 0,
    playbackRate: 1,
    paused: true,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      (listeners[type] ||= []).push(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    }),
    listeners,
    fire(type: string) {
      [...(listeners[type] || [])].forEach((fn) => fn());
    }
  };
  return el;
}

async function setupPlayer() {
  const holder: { player?: ReturnType<typeof usePodcastPlayer> } = {};
  const Host = defineComponent({
    setup() {
      holder.player = usePodcastPlayer();
      return () => h('div');
    }
  });
  await mountSuspended(Host);
  return holder.player!;
}

describe('formatPodcastTime', () => {
  it('renders M:SS / H:MM:SS, floors float seconds and maps invalid input to 0:00', () => {
    const cases: Array<[number | null | undefined, string]> = [
    [0, '0:00'], [9, '0:09'], [3599, '59:59'], [3600, '1:00:00'], [7325, '2:02:05'],
    // audio.currentTime is a float: floor instead of leaking "1:01:1.4000000000000341".
    [3661.4000000000005, '1:01:01'], [75.9, '1:15'],
    [null, '0:00'], [undefined, '0:00'], [NaN, '0:00'], [-5, '0:00'],
  ];
    for (const [input, expected] of cases) expect(formatPodcastTime(input), String(input)).toBe(expected);
  });
});

describe('clampSeekTime', () => {
  it('clamps to [0, duration] (lower bound only when the duration is unknown) and maps non-finite input to 0', () => {
    const cases: Array<[number, number, number]> = [
    [50, 100, 50], [-15, 100, 0], [130, 100, 100],
    [130, 0, 130], [-3, 0, 0], // unknown duration: only the lower bound applies
    [NaN, 100, 0], [Infinity, 100, 0],
  ];
    for (const [t, d, expected] of cases) expect(clampSeekTime(t, d), `${t}, ${d}`).toBe(expected);
  });
});

describe('isFinishedPosition', () => {
  it('is true within the (default 2s or custom) tolerance of a known, finite duration', () => {
    const cases: Array<[number, number, number | undefined, boolean]> = [
    [500, 3600, undefined, false], [3600, 3600, undefined, true], [3598.5, 3600, undefined, true],
    [3597.9, 3600, undefined, false], [3590, 3600, 15, true], [3580, 3600, 15, false],
    [9999, 0, undefined, false], [9999, -1, undefined, false], [NaN, 3600, undefined, false], [100, NaN, undefined, false],
  ];
    for (const [pos, dur, tol, expected] of cases) {
      expect(tol === undefined ? isFinishedPosition(pos, dur) : isFinishedPosition(pos, dur, tol), `${pos}, ${dur}, ${tol}`).toBe(expected);
    }
  });
});

describe('usePodcastPlayer', () => {
  let player: ReturnType<typeof usePodcastPlayer>;

  beforeEach(async () => {
    player = await setupPlayer();
    player.currentEpisode.value = null;
    player.isPlaying.value = false;
    player.currentTime.value = 0;
    player.duration.value = 0;
    player.playbackRate.value = 1;
    player.audioEl.value = null;
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(ACTIVE_KEY);
    player.lastPlayedAt.value = 0;
  });

  describe('play()', () => {
    it('loads the episode from zero and starts playback', async () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      const ep = episode('e1');
      player.play(ep);
      expect(player.currentEpisode.value?.id).toBe('e1');
      expect(el.src).toBe('/downloads-podcasts/a-show/e1.mp3');
      expect(el.currentTime).toBe(0);
      expect(player.currentTime.value).toBe(0);
      expect(el.play).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      expect(player.isPlaying.value).toBe(true);
    });

    it('resumes the saved mid-episode position when replaying the SAME episode id', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      const ep = episode('e1', { duration: 3600 });
      player.currentEpisode.value = ep;
      player.duration.value = 3600;
      player.currentTime.value = 1200;

      player.play(ep);
      // The position is applied once the element reports metadata, since
      // setting .src resets currentTime to 0 in a real browser.
      el.fire('loadedmetadata');
      expect(el.currentTime).toBe(1200);
      expect(player.currentTime.value).toBe(1200);
    });

    it('starts a DIFFERENT episode from zero even if a position was held', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');
      player.currentTime.value = 620;

      player.play(episode('e2'));
      expect(player.currentEpisode.value?.id).toBe('e2');
      expect(el.currentTime).toBe(0);
      expect(player.currentTime.value).toBe(0);
    });

    it('applies the current playback rate to the element', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.playbackRate.value = 1.5;
      player.play(episode('e1'));
      expect(el.playbackRate).toBe(1.5);
    });

    it('restarts from 0 when replaying an episode that already finished', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      const ep = episode('e1', { duration: 3600 });
      player.currentEpisode.value = ep;
      player.duration.value = 3600;
      // onEnded() persists a position at ~duration when an episode finishes.
      player.currentTime.value = 3600;

      player.play(ep);
      expect(el.currentTime).toBe(0);
      expect(player.currentTime.value).toBe(0);
    });

    it('sets isPlaying false when the browser rejects play()', async () => {
      const el = fakeAudio();
      el.play = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.play(episode('e1'));
      await Promise.resolve();
      await Promise.resolve();
      expect(player.isPlaying.value).toBe(false);
    });
  });

  describe('skipBack()/skipForward()/setPlaybackRate()', () => {
    beforeEach(() => {
      player.audioEl.value = fakeAudio() as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');
      player.duration.value = 3600;
    });

    it('skips back 15 seconds, clamped to 0', () => {
      player.currentTime.value = 100;
      player.skipBack();
      expect(player.currentTime.value).toBe(100 - SKIP_BACK_SECONDS);
      expect(player.audioEl.value!.currentTime).toBe(85);
      player.currentTime.value = 4;
      player.skipBack();
      expect(player.currentTime.value).toBe(0);
    });

    it('skips forward 30 seconds, clamped to the duration (or the episode metadata duration before the element reports one)', () => {
      player.currentTime.value = 100;
      player.skipForward();
      expect(player.currentTime.value).toBe(100 + SKIP_FORWARD_SECONDS);
      player.currentTime.value = 3590;
      player.skipForward();
      expect(player.currentTime.value).toBe(3600);
      player.currentEpisode.value = episode('e1', { duration: 120 });
      player.duration.value = 0;
      player.currentTime.value = 110;
      player.skipForward();
      expect(player.currentTime.value).toBe(120);
    });

    it('applies and persists an allowed playback rate, ignores one outside PLAYBACK_RATES', () => {
      player.setPlaybackRate(1.5);
      expect(player.playbackRate.value).toBe(1.5);
      expect(player.audioEl.value!.playbackRate).toBe(1.5);
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).playbackRate).toBe(1.5);
      expect(PLAYBACK_RATES).not.toContain(4);
      player.setPlaybackRate(4);
      expect(player.playbackRate.value).toBe(1.5);
    });
  });

  describe('saveToLocalStorage()/restoreFromLocalStorage()', () => {
    it('round-trips the full episode, position and rate without any server call', () => {
      player.currentEpisode.value = episode('e1');
      player.currentTime.value = 942.5;
      player.playbackRate.value = 1.25;
      player.saveToLocalStorage();

      player.currentEpisode.value = null;
      player.currentTime.value = 0;
      player.playbackRate.value = 1;

      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.restoreFromLocalStorage();

      expect(player.currentEpisode.value?.id).toBe('e1');
      expect(player.currentEpisode.value?.title).toBe('Episode e1');
      expect(player.currentTime.value).toBe(942.5);
      expect(player.playbackRate.value).toBe(1.25);
      expect(el.src).toBe('/downloads-podcasts/a-show/e1.mp3');
    });

    it('does NOT auto-play on restore', () => {
      player.currentEpisode.value = episode('e1');
      player.currentTime.value = 100;
      player.saveToLocalStorage();
      player.currentEpisode.value = null;

      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.restoreFromLocalStorage();

      expect(el.play).not.toHaveBeenCalled();
      expect(player.isPlaying.value).toBe(false);
    });

    it('saves nothing when there is no current episode', () => {
      player.currentEpisode.value = null;
      player.saveToLocalStorage();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it.each(['{not json', JSON.stringify({ episode: { id: 'x' } })])('clears the key and no-ops on a malformed or structurally invalid entry: %s', (raw) => {
      window.localStorage.setItem(STORAGE_KEY, raw);
      player.restoreFromLocalStorage();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(player.currentEpisode.value).toBeNull();
    });

    it('falls back to rate 1 when the stored rate is not an allowed value', () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ episode: episode('e1'), currentTime: 10, playbackRate: 9 })
      );
      player.playbackRate.value = 1.5;
      player.restoreFromLocalStorage();
      expect(player.playbackRate.value).toBe(1);
    });

    it('clears the stale entry and resets state when the restored episode fails to load', () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ episode: episode('e1'), currentTime: 300, playbackRate: 1 })
      );
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.restoreFromLocalStorage();
      expect(player.currentEpisode.value?.id).toBe('e1');

      // Simulate the deleted-file 404 firing before any user interaction.
      el.fire('error');

      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(player.currentEpisode.value).toBeNull();
      expect(player.currentTime.value).toBe(0);
      expect(player.duration.value).toBe(0);
      expect(player.isPlaying.value).toBe(false);
    });

    it('does NOT touch localStorage on a live playback error after the user pressed play', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      const ep = episode('e1');
      player.play(ep);
      player.saveToLocalStorage();
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

      // A transient network error mid-listen must not wipe the saved resume
      // position for an episode that otherwise works fine.
      el.fire('error');

      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
      expect(player.currentEpisode.value?.id).toBe('e1');
    });
  });

  describe('togglePlay()', () => {
    it('pauses when playing', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');
      player.isPlaying.value = true;
      player.togglePlay();
      expect(el.pause).toHaveBeenCalledTimes(1);
      expect(player.isPlaying.value).toBe(false);
    });

    it('does nothing without a current episode', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = null;
      player.togglePlay();
      expect(el.play).not.toHaveBeenCalled();
      expect(el.pause).not.toHaveBeenCalled();
    });
  });

  describe('activation and lastPlayedAt', () => {
    it('play() marks podcast active, stamps lastPlayedAt and persists it into the saved payload', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      const before = Date.now();
      player.play(episode('e1'));
      expect(useActiveMiniPlayer().activeType.value).toBe('podcast');
      expect(player.lastPlayedAt.value).toBeGreaterThanOrEqual(before);
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
      expect(saved.lastPlayedAt).toBe(player.lastPlayedAt.value);
      expect(saved.episode.id).toBe('e1');
      expect(saved.playbackRate).toBe(player.playbackRate.value);
    });

    it('restores a stored lastPlayedAt so a later save does not lose it', () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ episode: episode('e1'), currentTime: 10, playbackRate: 1, lastPlayedAt: 4242 })
      );
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.restoreFromLocalStorage();
      expect(player.lastPlayedAt.value).toBe(4242);

      player.saveToLocalStorage();
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
      expect(saved.lastPlayedAt).toBe(4242);
    });

    it('re-stamps lastPlayedAt when togglePlay() resumes, but not when it pauses', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');

      player.isPlaying.value = true;
      player.lastPlayedAt.value = 1;
      player.togglePlay();
      expect(player.lastPlayedAt.value).toBe(1);

      player.isPlaying.value = false;
      player.togglePlay();
      expect(player.lastPlayedAt.value).toBeGreaterThan(1);
    });
  });
});
