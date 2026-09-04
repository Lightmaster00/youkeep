import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { defineComponent, h } from 'vue';
import {
  useActiveMiniPlayer,
  readLastPlayedAt,
  pickActiveFromLastPlayedAt
} from '../../app/composables/useActiveMiniPlayer';

// useActiveMiniPlayer() is built on Nuxt's useState(), which is a singleton
// keyed by string and SHARED across every it() block in this file
// (@nuxt/test-utils reuses one Nuxt app per test file). Every test below sets
// the full state it needs up front rather than relying on the composable's
// initial value, which only applies the first time the key is touched.
// Mirrors tests/component/usePodcastPlayer.test.ts.

const ACTIVE_KEY = 'active_mini_player_type';
const MUSIC_KEY = 'music_player_state';
const PODCAST_KEY = 'podcast_player_state';

async function setupActive() {
  const holder: { active?: ReturnType<typeof useActiveMiniPlayer> } = {};
  const Host = defineComponent({
    setup() {
      holder.active = useActiveMiniPlayer();
      return () => h('div');
    }
  });
  await mountSuspended(Host);
  return holder.active!;
}

describe('readLastPlayedAt', () => {
  it('returns the stamp from a well-formed payload', () => {
    expect(readLastPlayedAt(JSON.stringify({ lastPlayedAt: 1725400000000 }))).toBe(1725400000000);
  });

  it('returns null for a missing key', () => {
    expect(readLastPlayedAt(null)).toBeNull();
  });

  it('returns null for malformed JSON instead of throwing', () => {
    expect(readLastPlayedAt('{not json')).toBeNull();
  });

  it('returns null for a legacy payload with no lastPlayedAt field', () => {
    // Every session saved before this feature shipped looks like this.
    expect(readLastPlayedAt(JSON.stringify({ currentTime: 42, playbackRate: 1 }))).toBeNull();
  });

  it('returns null for a non-finite or non-numeric stamp', () => {
    expect(readLastPlayedAt(JSON.stringify({ lastPlayedAt: 'yesterday' }))).toBeNull();
    expect(readLastPlayedAt(JSON.stringify({ lastPlayedAt: null }))).toBeNull();
  });
});

describe('pickActiveFromLastPlayedAt', () => {
  it('picks the more recently played type', () => {
    expect(pickActiveFromLastPlayedAt(200, 100)).toBe('music');
    expect(pickActiveFromLastPlayedAt(100, 200)).toBe('podcast');
  });

  it('picks the only side that has a stamp', () => {
    expect(pickActiveFromLastPlayedAt(100, null)).toBe('music');
    expect(pickActiveFromLastPlayedAt(null, 100)).toBe('podcast');
  });

  it('returns null when neither side has a stamp', () => {
    expect(pickActiveFromLastPlayedAt(null, null)).toBeNull();
  });

  it('breaks an exact tie deterministically in favour of music', () => {
    expect(pickActiveFromLastPlayedAt(500, 500)).toBe('music');
  });
});

describe('useActiveMiniPlayer', () => {
  let active: ReturnType<typeof useActiveMiniPlayer>;

  beforeEach(async () => {
    active = await setupActive();
    active.activeType.value = null;
    window.localStorage.removeItem(ACTIVE_KEY);
    window.localStorage.removeItem(MUSIC_KEY);
    window.localStorage.removeItem(PODCAST_KEY);
  });

  describe('setActive()', () => {
    it('writes state and localStorage together', () => {
      active.setActive('podcast');
      expect(active.activeType.value).toBe('podcast');
      expect(window.localStorage.getItem(ACTIVE_KEY)).toBe('podcast');
    });

    it('overwrites a previous activation', () => {
      active.setActive('podcast');
      active.setActive('music');
      expect(active.activeType.value).toBe('music');
      expect(window.localStorage.getItem(ACTIVE_KEY)).toBe('music');
    });
  });

  describe('restoreActiveType()', () => {
    it('round-trips a setActive() through localStorage', () => {
      active.setActive('podcast');
      active.activeType.value = null;
      active.restoreActiveType();
      expect(active.activeType.value).toBe('podcast');
    });

    it('leaves activeType null when nothing at all is persisted', () => {
      active.restoreActiveType();
      expect(active.activeType.value).toBeNull();
    });

    it('discards a garbage stored value and clears the key', () => {
      window.localStorage.setItem(ACTIVE_KEY, 'audiobook');
      active.restoreActiveType();
      expect(active.activeType.value).toBeNull();
      expect(window.localStorage.getItem(ACTIVE_KEY)).toBeNull();
    });

    it('falls back to the more recent lastPlayedAt when the active key is absent', () => {
      window.localStorage.setItem(MUSIC_KEY, JSON.stringify({ lastPlayedAt: 1000 }));
      window.localStorage.setItem(PODCAST_KEY, JSON.stringify({ lastPlayedAt: 2000 }));
      active.restoreActiveType();
      expect(active.activeType.value).toBe('podcast');
    });

    it('does NOT use the tie-break when the active key IS present', () => {
      window.localStorage.setItem(ACTIVE_KEY, 'music');
      window.localStorage.setItem(MUSIC_KEY, JSON.stringify({ lastPlayedAt: 1000 }));
      window.localStorage.setItem(PODCAST_KEY, JSON.stringify({ lastPlayedAt: 9999 }));
      active.restoreActiveType();
      expect(active.activeType.value).toBe('music');
    });

    it('falls back to the persisted session when both are legacy (no lastPlayedAt)', () => {
      // Both sessions predate this feature: without this rung neither bar
      // would ever show. Music wins by convention.
      window.localStorage.setItem(MUSIC_KEY, JSON.stringify({ currentTime: 5 }));
      window.localStorage.setItem(PODCAST_KEY, JSON.stringify({ currentTime: 7 }));
      active.restoreActiveType();
      expect(active.activeType.value).toBe('music');
    });

    it('falls back to the only persisted session when it is a legacy podcast one', () => {
      window.localStorage.setItem(PODCAST_KEY, JSON.stringify({ currentTime: 7 }));
      active.restoreActiveType();
      expect(active.activeType.value).toBe('podcast');
    });
  });

  describe('storage failures', () => {
    // Simulates Chrome's "block all cookies" (SecurityError touching
    // localStorage) or Safari private-browsing / a full quota
    // (QuotaExceededError on setItem): both throw synchronously rather than
    // silently no-oping.
    //
    // NOTE: vi.spyOn(Storage.prototype, ...) does NOT reliably intercept
    // calls made through window.localStorage in this project's happy-dom
    // environment, because window.localStorage is a Proxy rather than a
    // plain Storage.prototype instance. Spying getItem never takes effect at
    // all; spying setItem only works before window.localStorage.setItem has
    // been accessed elsewhere in the file (it already has been, by the
    // describe blocks above). So instead of spying, each test below swaps
    // window.localStorage itself for a thin wrapper object that delegates to
    // the real storage except where the test wants a call to throw, then
    // restores the real object in afterEach. vi.restoreAllMocks() does not
    // undo this kind of instance swap, so the restoration is done manually
    // to guarantee no leakage into other tests.
    let realLocalStorage: Storage;

    beforeEach(() => {
      realLocalStorage = window.localStorage;
    });

    afterEach(() => {
      Object.defineProperty(window, 'localStorage', {
        value: realLocalStorage,
        configurable: true,
        writable: true
      });
    });

    function installFakeStorage(overrides: Partial<Storage>) {
      const fake: Storage = {
        getItem: (key: string) => realLocalStorage.getItem(key),
        setItem: (key: string, value: string) => realLocalStorage.setItem(key, value),
        removeItem: (key: string) => realLocalStorage.removeItem(key),
        clear: () => realLocalStorage.clear(),
        key: (index: number) => realLocalStorage.key(index),
        get length() {
          return realLocalStorage.length;
        },
        ...overrides
      } as Storage;

      Object.defineProperty(window, 'localStorage', {
        value: fake,
        configurable: true,
        writable: true
      });
    }

    it('setActive() still updates in-memory state when localStorage.setItem throws', () => {
      installFakeStorage({
        setItem: () => {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        }
      });

      expect(() => active.setActive('podcast')).not.toThrow();
      expect(active.activeType.value).toBe('podcast');
    });

    it('restoreActiveType() falls through to null when every localStorage read throws', () => {
      installFakeStorage({
        getItem: () => {
          throw new DOMException('access denied', 'SecurityError');
        }
      });

      expect(() => active.restoreActiveType()).not.toThrow();
      expect(active.activeType.value).toBeNull();
    });

    it('restoreActiveType() still reaches the lastPlayedAt rung when only the active key read throws', () => {
      window.localStorage.setItem(MUSIC_KEY, JSON.stringify({ lastPlayedAt: 1000 }));
      window.localStorage.setItem(PODCAST_KEY, JSON.stringify({ lastPlayedAt: 2000 }));

      installFakeStorage({
        getItem: (key: string) => {
          if (key === ACTIVE_KEY) throw new DOMException('access denied', 'SecurityError');
          return realLocalStorage.getItem(key);
        }
      });

      expect(() => active.restoreActiveType()).not.toThrow();
      expect(active.activeType.value).toBe('podcast');
    });
  });
});
