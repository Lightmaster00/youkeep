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

// usePodcastPlayer() is built on Nuxt's useState(), which is a singleton keyed
// by string and SHARED across every it() block in this file (@nuxt/test-utils
// reuses one Nuxt app per test file). Every test below sets the full state it
// needs up front rather than relying on the composable's initial values, which
// only apply the first time a key is touched. Mirrors
// tests/component/useMusicPlayer.test.ts.

const STORAGE_KEY = 'podcast_player_state';

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
  it('renders M:SS below one hour', () => {
    expect(formatPodcastTime(0)).toBe('0:00');
    expect(formatPodcastTime(9)).toBe('0:09');
    expect(formatPodcastTime(75)).toBe('1:15');
    expect(formatPodcastTime(3599)).toBe('59:59');
  });

  it('renders H:MM:SS at one hour and above', () => {
    expect(formatPodcastTime(3600)).toBe('1:00:00');
    expect(formatPodcastTime(3661)).toBe('1:01:01');
    expect(formatPodcastTime(7325)).toBe('2:02:05');
  });

  it('floors fractional seconds instead of leaking float noise', () => {
    // audio.currentTime is a float; podcasts/index.vue's own formatter does
    // `seconds % 60` unfloored, which would render "1:01:1.4000000000000341".
    expect(formatPodcastTime(3661.4000000000005)).toBe('1:01:01');
    expect(formatPodcastTime(75.9)).toBe('1:15');
  });

  it('returns 0:00 for null, undefined, NaN and negatives', () => {
    expect(formatPodcastTime(null)).toBe('0:00');
    expect(formatPodcastTime(undefined)).toBe('0:00');
    expect(formatPodcastTime(NaN)).toBe('0:00');
    expect(formatPodcastTime(-5)).toBe('0:00');
  });
});

describe('clampSeekTime', () => {
  it('passes through a time inside the range', () => {
    expect(clampSeekTime(50, 100)).toBe(50);
  });

  it('clamps below zero to zero', () => {
    expect(clampSeekTime(-15, 100)).toBe(0);
  });

  it('clamps past the duration to the duration', () => {
    expect(clampSeekTime(130, 100)).toBe(100);
  });

  it('only clamps the lower bound when the duration is unknown (0)', () => {
    expect(clampSeekTime(130, 0)).toBe(130);
    expect(clampSeekTime(-3, 0)).toBe(0);
  });

  it('returns 0 for non-finite input', () => {
    expect(clampSeekTime(NaN, 100)).toBe(0);
    expect(clampSeekTime(Infinity, 100)).toBe(0);
  });
});

describe('isFinishedPosition', () => {
  it('is false for a position well before the end', () => {
    expect(isFinishedPosition(500, 3600)).toBe(false);
  });

  it('is true for a position exactly at the duration', () => {
    expect(isFinishedPosition(3600, 3600)).toBe(true);
  });

  it('is true for a position within the default 2s tolerance of the end', () => {
    expect(isFinishedPosition(3599, 3600)).toBe(true);
    expect(isFinishedPosition(3598.5, 3600)).toBe(true);
  });

  it('is false just outside the tolerance', () => {
    expect(isFinishedPosition(3597.9, 3600)).toBe(false);
  });

  it('respects a custom tolerance', () => {
    expect(isFinishedPosition(3590, 3600, 15)).toBe(true);
    expect(isFinishedPosition(3580, 3600, 15)).toBe(false);
  });

  it('is false when duration is unknown (<= 0)', () => {
    expect(isFinishedPosition(9999, 0)).toBe(false);
    expect(isFinishedPosition(9999, -1)).toBe(false);
  });

  it('is false for non-finite input', () => {
    expect(isFinishedPosition(NaN, 3600)).toBe(false);
    expect(isFinishedPosition(100, NaN)).toBe(false);
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

    it('resumes the saved position when replaying the SAME episode id', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      const ep = episode('e1');
      player.currentEpisode.value = ep;
      player.currentTime.value = 620;

      player.play(ep);
      // The position is applied once the element reports metadata, since
      // setting .src resets currentTime to 0 in a real browser.
      el.fire('loadedmetadata');
      expect(el.currentTime).toBe(620);
      expect(player.currentTime.value).toBe(620);
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

    it('still resumes mid-episode when the held position is well before the end', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      const ep = episode('e1', { duration: 3600 });
      player.currentEpisode.value = ep;
      player.duration.value = 3600;
      player.currentTime.value = 1200;

      player.play(ep);
      el.fire('loadedmetadata');
      expect(el.currentTime).toBe(1200);
      expect(player.currentTime.value).toBe(1200);
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

  describe('skipBack()/skipForward()', () => {
    it('skips back 15 seconds', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');
      player.duration.value = 3600;
      player.currentTime.value = 100;
      player.skipBack();
      expect(player.currentTime.value).toBe(100 - SKIP_BACK_SECONDS);
      expect(el.currentTime).toBe(85);
    });

    it('clamps a skip back near the start to 0', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');
      player.duration.value = 3600;
      player.currentTime.value = 4;
      player.skipBack();
      expect(player.currentTime.value).toBe(0);
    });

    it('skips forward 30 seconds', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');
      player.duration.value = 3600;
      player.currentTime.value = 100;
      player.skipForward();
      expect(player.currentTime.value).toBe(100 + SKIP_FORWARD_SECONDS);
    });

    it('clamps a skip forward near the end to the duration', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');
      player.duration.value = 3600;
      player.currentTime.value = 3590;
      player.skipForward();
      expect(player.currentTime.value).toBe(3600);
    });

    it('falls back to the episode metadata duration when the element has not reported one', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1', { duration: 120 });
      player.duration.value = 0;
      player.currentTime.value = 110;
      player.skipForward();
      expect(player.currentTime.value).toBe(120);
    });
  });

  describe('setPlaybackRate()', () => {
    it('applies an allowed rate to state and the element and persists it', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.currentEpisode.value = episode('e1');
      player.setPlaybackRate(1.5);
      expect(player.playbackRate.value).toBe(1.5);
      expect(el.playbackRate).toBe(1.5);
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
      expect(saved.playbackRate).toBe(1.5);
    });

    it('ignores a rate outside PLAYBACK_RATES', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.playbackRate.value = 1;
      player.setPlaybackRate(4);
      expect(player.playbackRate.value).toBe(1);
      expect(PLAYBACK_RATES).not.toContain(4);
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

    it('clears the key and no-ops on malformed JSON', () => {
      window.localStorage.setItem(STORAGE_KEY, '{not json');
      player.restoreFromLocalStorage();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(player.currentEpisode.value).toBeNull();
    });

    it('clears the key and no-ops on a structurally invalid entry', () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ episode: { id: 'x' } }));
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
});
