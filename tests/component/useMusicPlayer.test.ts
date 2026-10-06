import { describe, it, expect, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { defineComponent, h } from 'vue';
import { useMusicPlayer, type PlayableTrack } from '../../app/composables/useMusicPlayer';
import { useActiveMiniPlayer } from '../../app/composables/useActiveMiniPlayer';

// useMusicPlayer() is built on Nuxt's useState(), which is a singleton keyed
// by string ("music_player_queue", "music_player_current_index", etc.) and
// SHARED across every call within the same Nuxt app instance -- including
// across every `it()` block in this file, since @nuxt/test-utils reuses one
// Nuxt app per test file. Each test below explicitly sets the full state it
// needs before asserting, rather than relying on the composable's default
// initial values (which only apply the very first time a key is touched).
//
// useMusicPlayer() is not itself a component, so it must be invoked from
// inside a host component's setup() and mounted with mountSuspended --
// that's what gives it access to Nuxt's useState. Destructuring the
// composable's return value into a variable declared before mountSuspended()
// resolves does NOT work: the getter/variable would be captured before
// setup() has run. Instead we stash it on a holder object and read it back
// after awaiting mountSuspended().

function track(id: string): PlayableTrack {
  return { id, title: `Track ${id}`, local_file_path: `${id}.mp3` };
}

async function setupPlayer() {
  const holder: { player?: ReturnType<typeof useMusicPlayer> } = {};
  const Host = defineComponent({
    setup() {
      holder.player = useMusicPlayer();
      return () => h('div');
    }
  });
  await mountSuspended(Host);
  return holder.player!;
}

describe('useMusicPlayer', () => {
  let player: ReturnType<typeof useMusicPlayer>;

  beforeEach(async () => {
    player = await setupPlayer();
    // Reset every piece of shared state to a known baseline before each test.
    player.queue.value = [];
    player.currentIndex.value = -1;
    player.currentTrack.value = null;
    player.isPlaying.value = false;
    player.currentTime.value = 0;
    player.duration.value = 0;
    player.audioEl.value = null;
    player.shuffleOn.value = false;
    player.repeatMode.value = 'off';
    player.lastPlayedAt.value = 0;
    window.localStorage.removeItem('music_player_state');
    window.localStorage.removeItem('active_mini_player_type');
  });

  describe('play()', () => {
    it('sets currentTrack/currentIndex to the matching track when it is already queued, keeping the given order', () => {
      // Note: Vue wraps `queue.value` in a reactive proxy on assignment, so
      // the assigned array is never the exact same object reference as the
      // input `tracks` array even when play() does `queue.value = tracks`
      // with no copying -- toBe() identity checks against `tracks` will
      // always fail here regardless of whether a copy happened internally.
      // The real, observable contract is the resulting content and order.
      const t1 = track('1');
      const t2 = track('2');
      const tracks = [t1, t2];
      player.play(t2, tracks);
      expect(player.queue.value.map((t) => t.id)).toEqual(['1', '2']);
      expect(player.currentIndex.value).toBe(1);
      expect(player.currentTrack.value?.id).toBe('2');
    });

    it('prepends the track and sets currentIndex to 0 when the track is not in the queue', () => {
      const t1 = track('1');
      const t2 = track('2');
      player.play(t1, [t2]);
      expect(player.queue.value.map((t) => t.id)).toEqual(['1', '2']);
      expect(player.currentIndex.value).toBe(0);
      expect(player.currentTrack.value?.id).toBe('1');
    });
  });

  describe('next()/prev() with repeatMode', () => {
    function seedQueue() {
      const tracks = [track('1'), track('2'), track('3')];
      player.play(tracks[0]!, tracks);
      return tracks;
    }

    const at = (i: number, mode: 'off' | 'all' | 'one') => {
      const tracks = seedQueue();
      player.currentIndex.value = i;
      player.currentTrack.value = tracks[i]!;
      player.repeatMode.value = mode;
    };
    const pos = () => [player.currentTrack.value?.id, player.currentIndex.value];

    it("next(): stops at the end with 'off', wraps with 'all', replays the same index with 'one'", () => {
      at(2, 'off');
      player.next();
      expect(pos()).toEqual(['3', 2]);
      expect(player.isPlaying.value).toBe(false);
      at(2, 'all');
      player.next();
      expect(pos()).toEqual(['1', 0]);
      at(1, 'one');
      player.next();
      expect(pos()).toEqual(['2', 1]);
    });

    it("prev(): stops at the start with 'off', wraps with 'all', and does NOT special-case 'one'", () => {
      at(0, 'off');
      player.prev();
      expect(pos()).toEqual(['1', 0]);
      expect(player.isPlaying.value).toBe(false);
      at(0, 'all');
      player.prev();
      expect(pos()).toEqual(['3', 2]);
      // prevIndex() only special-cases shuffle and 'all' (asymmetric with nextIndex()).
      at(1, 'one');
      player.prev();
      expect(pos()).toEqual(['1', 0]);
    });
  });

  describe('toggleShuffle()', () => {
    it('generates a shuffledOrder holding every queue index exactly once, cleared when toggled back off', () => {
      const tracks = [track('1'), track('2'), track('3'), track('4')];
      player.play(tracks[0]!, tracks);
      player.toggleShuffle();
      expect(player.shuffleOn.value).toBe(true);
      const shuffled = useState<number[] | null>('music_player_shuffled_order').value;
      expect(shuffled).not.toBeNull();
      expect([...shuffled!].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
      player.toggleShuffle();
      expect(player.shuffleOn.value).toBe(false);
      const order = useState<number[] | null>('music_player_shuffled_order').value;
      expect(order).toBeNull();
    });
  });

  describe('replaceQueueKeepingCurrent()', () => {
    it('updates queue/currentIndex/currentTrack without touching audioEl or hasCountedThisPlay', () => {
      const t1 = track('1');
      const t2 = track('2');
      player.play(t1, [t1]);

      // Simulate an attached <audio> element and a play already counted --
      // hasCountedThisPlay is intentionally not part of useMusicPlayer()'s
      // returned object, but since useState() is keyed globally we can read
      // it back directly by its key, the same way the composable does
      // internally.
      const fakeAudioEl = { src: 'original.mp3', currentTime: 42 } as unknown as HTMLMediaElement;
      player.audioEl.value = fakeAudioEl;
      const hasCounted = useState<boolean>('music_player_has_counted');
      hasCounted.value = true;

      player.replaceQueueKeepingCurrent(t2, [t1, t2]);

      expect(player.queue.value.map((t) => t.id)).toEqual(['1', '2']);
      expect(player.currentIndex.value).toBe(1);
      expect(player.currentTrack.value?.id).toBe('2');
      // audioEl.src/currentTime must be untouched -- unlike play()/next()/
      // prev() (which call loadTrack() and reset src + currentTime),
      // replaceQueueKeepingCurrent() never calls loadTrack().
      expect(player.audioEl.value?.src).toBe('original.mp3');
      expect(player.audioEl.value?.currentTime).toBe(42);
      // hasCountedThisPlay must not have been reset to false
      expect(hasCounted.value).toBe(true);
    });

    it('prepends and sets currentIndex to 0 when the new track is not in the given list', () => {
      const t1 = track('1');
      const t2 = track('2');
      player.play(t1, [t1]);
      player.replaceQueueKeepingCurrent(t2, [t1]);
      expect(player.queue.value.map((t) => t.id)).toEqual(['2', '1']);
      expect(player.currentIndex.value).toBe(0);
      expect(player.currentTrack.value?.id).toBe('2');
    });
  });

  describe('activation and lastPlayedAt', () => {
    // This file does not import `vi` and has no shared audio fake (its only
    // existing one, at line 189, is a bare `{ src, currentTime }` literal).
    // togglePlay() bails out unless audioEl has real play()/pause() methods,
    // so this block builds a minimal plain-object element of its own rather
    // than adding a vitest import the rest of the file does not need.
    function fakeEl() {
      return {
        src: '',
        currentTime: 0,
        volume: 1,
        play: () => Promise.resolve(),
        pause: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
      } as unknown as HTMLMediaElement;
    }

    it('play() marks music active, stamps lastPlayedAt and persists it into the saved payload', () => {
      const before = Date.now();
      player.play(track('1'), [track('1')]);
      expect(useActiveMiniPlayer().activeType.value).toBe('music');
      expect(player.lastPlayedAt.value).toBeGreaterThanOrEqual(before);
      const saved = JSON.parse(window.localStorage.getItem('music_player_state')!);
      expect(saved.lastPlayedAt).toBe(player.lastPlayedAt.value);
      expect(saved.trackId).toBe('1');
      expect(saved.queueTrackIds).toEqual(['1']);
    });

    it('re-stamps lastPlayedAt when togglePlay() resumes, but not when it pauses', () => {
      player.audioEl.value = fakeEl();
      player.currentTrack.value = track('1');

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
