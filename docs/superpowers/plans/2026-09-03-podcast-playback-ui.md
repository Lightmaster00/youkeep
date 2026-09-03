# Podcast Playback UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing playback layer to YouKeep's Podcasts module — a persistent mini-player (play/pause, seek, skip ±15s/30s, speed control, localStorage resume) plus a play button on completed episode rows in `/podcasts`.

**Architecture:** Three pieces mirroring Music mode's playback architecture, minus everything queue-shaped. `app/composables/usePodcastPlayer.ts` holds global player state via Nuxt's `useState()` (singleton keys, exactly like `useMusicPlayer.ts`) and exports two pure helpers (`formatPodcastTime`, `clampSeekTime`) that are unit-tested. `app/components/PodcastMiniPlayer.vue` owns the single `<audio>` element, registers it into the composable via a `watch` on the template ref, and renders the fixed-bottom bar. `app/layouts/default.vue` mounts the component once so playback survives navigation. `app/pages/podcasts/index.vue` gets a play button per completed episode row.

**Tech Stack:** Nuxt 4 (auto-imported `useState`, `$fetch`), Vue 3 `<script setup lang="ts">`, native `<audio>` + HTTP Range (already supported by `server/routes/downloads-podcasts/[...path].ts`), Vitest 4 with the `component` project (`environment: 'nuxt'`, `@nuxt/test-utils/runtime`'s `mountSuspended`), `@vue/test-utils`.

## Global Constraints

- No episode queue/playlist concept — no prev/next-episode, no shuffle, no repeat.
- No server-side resume position — no new DB column/table. Resume is localStorage-only, per browser.
- No play-count / "recently played" / "most played" tracking — no new endpoint, no new column.
- No video/clip mode — plain `<audio>` only, no hidden `<video>` element.
- No changes to any of the podcast admin API routes, `server/utils/podcastDownloader.ts`, or the file-serving route (`server/routes/downloads-podcasts/[...path].ts`) — playback consumes the already-shipped `local_file_path` URLs as-is.
- `restoreFromLocalStorage()` must NOT auto-play on mount — it only restores state so the mini-player shows a "ready to resume" state; playback requires a user click, matching Music's existing restore behavior.
- A live playback component with no meaningful automated-test surface gets no automated tests (matching `MusicMiniPlayer.vue`, which has none) — verified manually in the final task. Only genuinely pure, extractable helper functions (if the plan decides to extract any) get real unit tests.

---

## Decisions Made Before Implementation (read this first)

These were resolved by reading the actual code, not the spec's sketch. Do not "fix" them back.

**1. The localStorage payload stores the whole episode, not just an ID.**
The spec's `usePodcastPlayer.ts` section says the stored shape is `{ episodeId, currentTime, playbackRate }`. That works for Music only because `restoreFromLocalStorage()` there re-hydrates tracks through `POST /api/music/tracks/by-ids` (see `useMusicPlayer.ts:227`). **There is no podcast equivalent of that endpoint**, and the Global Constraints forbid adding one. Storing only an ID would therefore leave nothing to render on reload. Resolution: store a full `PlayableEpisode` snapshot: `{ episode: PlayableEpisode, currentTime: number, playbackRate: number }`. This needs no server call at all, which is strictly *more* aligned with the spec's "no server calls during playback". A restored episode whose file has since been deleted simply produces the normal playback-error toast on the user's first click.

**2. Pure helpers ARE extracted — but into the composable module, not a new shared util module.**
The spec leaves this open. Decision: `formatPodcastTime(seconds)` and `clampSeekTime(seconds, durationSeconds)` are exported at module scope from `app/composables/usePodcastPlayer.ts` and get real unit tests. Rationale: (a) both are consumed by *two* call sites each (composable + component), so a single copy is genuinely DRY rather than speculative sharing; (b) a *new shared formatting module* would break this codebase's established per-page-duplication convention (`app/pages/podcasts/index.vue:251-253` documents that convention explicitly; `music/index.vue`, `channels.vue`, `watch/[id].vue` all duplicate their own `formatDuration`), so nothing is hoisted out of the existing pages; (c) there is direct precedent for testing a player composable — `tests/component/useMusicPlayer.test.ts` exists and tests `useMusicPlayer()` through `mountSuspended`. The new test file follows that file's structure exactly.

**3. `formatPodcastTime` floors seconds; `app/pages/podcasts/index.vue`'s existing `formatDuration` is left untouched.**
The page's formatter (line 263) computes `const secs = seconds % 60` **without flooring** — harmless there because `duration` comes from the DB as an integer, but wrong for a mini-player fed `audio.currentTime`, which is a float (`3661.4` would render `1:01:1.4000000000000341`). The new helper floors every component. The page's copy is not modified: it is correct for its own input and touching it is out of scope.

**4. Music and Podcast mini-players must not overlap or play simultaneously.**
Both are `position: fixed; bottom: 0`. Reading `app/layouts/default.vue:105`, the content area's bottom padding is driven by `:class="{ 'has-mini-player': !!currentTrack }"`, which knows nothing about podcasts. Resolution (Task 3): the podcast bar renders at `bottom: 72px` (`.is-stacked`) when a music track is also loaded; the layout's padding class accounts for one or two bars; and each player pauses the other on `@play`, so two audio streams can never run at once. The Music-side half of that is a 4-line change to `MusicMiniPlayer.vue` — allowed, since the Global Constraints only freeze *server* files.

**5. Verified field names against the real API routes.**
- `GET /api/podcasts/shows/:id/episodes` (`server/api/podcasts/shows/[id]/episodes.get.ts:43-52`) returns exactly: `id, show_id, title, description, episode_number, season_number, duration, pub_date, download_status, local_file_path`. There is **no** `cover_url` on an episode.
- `GET /api/podcasts/shows/:id` (`server/api/podcasts/shows/[id]/index.get.ts`) returns `show` with `id, title, description, author, cover_url, language, visibility` — so the show-level `title`/`cover_url` the play button passes along are both available in the page's `show` ref.
- `local_file_path` is written by `server/utils/podcastDownloader.ts:404` as a **URL path** (`/downloads-podcasts/{folder}/{episodeId}.{ext}`), not a filesystem path, so it can be assigned straight to `audio.src`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/composables/usePodcastPlayer.ts` (create) | Global player state + actions + two exported pure helpers. |
| `tests/component/usePodcastPlayer.test.ts` (create) | Unit tests for the pure helpers and the composable's state transitions. |
| `app/components/PodcastMiniPlayer.vue` (create) | The `<audio>` element and the fixed-bottom bar UI. No automated tests (per Global Constraints). |
| `app/layouts/default.vue` (modify) | Mount the mini-player once; size the content area's bottom padding; nothing else. |
| `app/components/MusicMiniPlayer.vue` (modify) | 4 lines: pause podcast playback when music starts. |
| `app/pages/podcasts/index.vue` (modify) | Play button on completed episode rows. |

---

## Task 1: `usePodcastPlayer.ts` composable

**Files:**
- Create: `app/composables/usePodcastPlayer.ts`
- Test: `tests/component/usePodcastPlayer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Uses Nuxt's auto-imported `useState`.
- Produces (later tasks rely on these exact names/types):
  - `export interface PlayableEpisode { id: string; title: string; show_title?: string; show_cover_url?: string | null; duration?: number | null; local_file_path: string; }`
  - `export const PLAYBACK_RATES: readonly number[]` — `[0.75, 1, 1.25, 1.5, 1.75, 2]`
  - `export const SKIP_BACK_SECONDS = 15`, `export const SKIP_FORWARD_SECONDS = 30`
  - `export function formatPodcastTime(seconds: number | null | undefined): string` — `H:MM:SS` past one hour, `M:SS` otherwise, `0:00` for falsy/invalid.
  - `export function clampSeekTime(seconds: number, durationSeconds: number): number`
  - `export function usePodcastPlayer()` returning `{ currentEpisode: Ref<PlayableEpisode | null>, isPlaying: Ref<boolean>, currentTime: Ref<number>, duration: Ref<number>, playbackRate: Ref<number>, audioEl: Ref<HTMLMediaElement | null>, play(episode: PlayableEpisode): void, togglePlay(): void, seek(seconds: number): void, skipBack(): void, skipForward(): void, setPlaybackRate(rate: number): void, saveToLocalStorage(): void, restoreFromLocalStorage(): void }`
  - `useState` keys (stable, referenced by tests): `podcast_player_current_episode`, `podcast_player_is_playing`, `podcast_player_current_time`, `podcast_player_duration`, `podcast_player_rate`, `podcast_player_audio_el`. localStorage key: `podcast_player_state`.

- [ ] **Step 1: Write the failing test file**

Create `tests/component/usePodcastPlayer.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { defineComponent, h } from 'vue';
import {
  usePodcastPlayer,
  formatPodcastTime,
  clampSeekTime,
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- usePodcastPlayer`
Expected: FAIL — the suite cannot even collect, with an error resolving `../../app/composables/usePodcastPlayer` (file does not exist).

- [ ] **Step 3: Write the composable**

Create `app/composables/usePodcastPlayer.ts`:

```ts
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

  // Effective duration: the element's reported duration once metadata has
  // loaded, otherwise the RSS-provided duration from podcast_episodes.
  function effectiveDuration(): number {
    return duration.value || currentEpisode.value?.duration || 0;
  }

  function loadEpisode(episode: PlayableEpisode, startAt: number) {
    currentEpisode.value = episode;
    currentTime.value = startAt;
    duration.value = 0;

    const el = audioEl.value;
    if (!el) return;

    el.src = episode.local_file_path;
    el.playbackRate = playbackRate.value;

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

  function play(episode: PlayableEpisode) {
    // Replaying the episode already loaded picks up where it left off (that
    // is what makes the restored "resume" state resume); any other episode
    // starts from the beginning.
    const resumeAt = currentEpisode.value?.id === episode.id ? currentTime.value : 0;
    loadEpisode(episode, resumeAt);
    const el = audioEl.value;
    if (el) {
      el.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
  }

  function togglePlay() {
    if (!audioEl.value || !currentEpisode.value) return;
    if (isPlaying.value) {
      audioEl.value.pause();
      isPlaying.value = false;
    } else {
      audioEl.value.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
  }

  function seek(seconds: number) {
    if (!audioEl.value) return;
    const target = clampSeekTime(seconds, effectiveDuration());
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
    const state = {
      episode: currentEpisode.value,
      currentTime: currentTime.value,
      playbackRate: playbackRate.value,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // No server call: the whole PlayableEpisode is stored client-side, since
  // podcasts have no by-ids rehydration endpoint (and adding one is out of
  // scope). Never auto-plays — it only primes the mini-player.
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

    const restoreTime =
      typeof saved.currentTime === 'number' && Number.isFinite(saved.currentTime) && saved.currentTime > 0
        ? saved.currentTime
        : 0;
    loadEpisode(saved.episode, restoreTime);
  }

  return {
    currentEpisode, isPlaying, currentTime, duration, playbackRate, audioEl,
    play, togglePlay, seek, skipBack, skipForward, setPlaybackRate,
    saveToLocalStorage, restoreFromLocalStorage,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- usePodcastPlayer`
Expected: PASS — all tests in `tests/component/usePodcastPlayer.test.ts` green.

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — both the `server` and `component` projects, same counts as before plus the new file.

- [ ] **Step 6: Commit**

```bash
git add app/composables/usePodcastPlayer.ts tests/component/usePodcastPlayer.test.ts
git commit -m "feat: add usePodcastPlayer composable with localStorage resume"
```

---

## Task 2: `PodcastMiniPlayer.vue` component

**Files:**
- Create: `app/components/PodcastMiniPlayer.vue`

**Interfaces:**
- Consumes (from Task 1, exact names): `usePodcastPlayer()` → `currentEpisode`, `isPlaying`, `currentTime`, `duration`, `playbackRate`, `audioEl`, `togglePlay()`, `seek(seconds)`, `skipBack()`, `skipForward()`, `setPlaybackRate(rate)`, `saveToLocalStorage()`, `restoreFromLocalStorage()`; plus `formatPodcastTime(seconds)` and `PLAYBACK_RATES`. Also `useToast()` → `error(msg)` from `app/composables/useToast.ts`.
- Produces: the component `<PodcastMiniPlayer />` (Nuxt auto-imports components from `app/components/`, so Task 3 needs no import statement). Exposes a `stacked` visual mode driven internally by `useMusicPlayer().currentTrack` — Task 3 does not pass props.

Per the Global Constraints, this component gets **no** automated tests (matching `MusicMiniPlayer.vue`); it is verified manually in Task 5.

- [ ] **Step 1: Create the component**

Create `app/components/PodcastMiniPlayer.vue`:

```vue
<template>
  <audio
    ref="audioElRef"
    class="podcast-mini-player-audio"
    preload="metadata"
    @timeupdate="onTimeUpdate"
    @loadedmetadata="onLoadedMetadata"
    @durationchange="onLoadedMetadata"
    @ended="onEnded"
    @play="onPlay"
    @pause="isPlaying = false"
    @error="onAudioError"
  ></audio>

  <div v-if="currentEpisode" class="podcast-mini-player" :class="{ 'is-stacked': !!currentTrack }">
    <img :src="currentEpisode.show_cover_url || fallbackCover" @error="handleCoverError" class="podcast-mini-player-cover" alt="" />

    <div class="podcast-mini-player-info">
      <span class="podcast-mini-player-title">{{ currentEpisode.title }}</span>
      <span class="podcast-mini-player-show">{{ currentEpisode.show_title || '' }}</span>
    </div>

    <div class="podcast-mini-player-controls">
      <button @click="skipBack" class="podcast-mini-player-btn" title="Reculer de 15 secondes" aria-label="Reculer de 15 secondes">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
        <span class="podcast-mini-player-skip-label">15</span>
      </button>
      <button @click="togglePlay" class="podcast-mini-player-btn podcast-mini-player-play-btn" title="Lecture/Pause" aria-label="Lecture/Pause">
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </button>
      <button @click="skipForward" class="podcast-mini-player-btn" title="Avancer de 30 secondes" aria-label="Avancer de 30 secondes">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"></path></svg>
        <span class="podcast-mini-player-skip-label">30</span>
      </button>
    </div>

    <div class="podcast-mini-player-progress-row">
      <span class="podcast-mini-player-time">{{ formatPodcastTime(currentTime) }}</span>
      <div class="podcast-mini-player-progress-bar" @click="onProgressClick" ref="progressBarRef">
        <div class="podcast-mini-player-progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="podcast-mini-player-time">{{ formatPodcastTime(displayDuration) }}</span>
    </div>

    <div class="podcast-mini-player-extra-controls">
      <select
        class="podcast-mini-player-rate"
        :value="playbackRate"
        @change="onRateChange"
        title="Vitesse de lecture"
        aria-label="Vitesse de lecture"
      >
        <option v-for="rate in PLAYBACK_RATES" :key="rate" :value="rate">{{ rate }}x</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { usePodcastPlayer, formatPodcastTime, PLAYBACK_RATES } from '~/composables/usePodcastPlayer';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { useToast } from '~/composables/useToast';

const {
  currentEpisode, isPlaying, currentTime, duration, playbackRate, audioEl,
  togglePlay, seek, skipBack, skipForward, setPlaybackRate,
  saveToLocalStorage, restoreFromLocalStorage,
} = usePodcastPlayer();

// Read-only here: used to offset this bar above the music bar when both are
// loaded, and to stop music when podcast playback starts (Task 3 adds the
// mirror-image guard on the music side).
const { currentTrack, audioEl: musicAudioEl, isPlaying: musicIsPlaying } = useMusicPlayer();

const toast = useToast();
const audioElRef = ref<HTMLAudioElement | null>(null);
const progressBarRef = ref<HTMLDivElement | null>(null);

// Before metadata loads, duration.value is 0 — fall back to the RSS duration
// so the right-hand time label isn't stuck at 0:00 on a restored episode.
const displayDuration = computed(() => duration.value || currentEpisode.value?.duration || 0);
const progressPercent = computed(() =>
  displayDuration.value > 0 ? (currentTime.value / displayDuration.value) * 100 : 0
);

function onTimeUpdate() {
  if (!audioElRef.value) return;
  currentTime.value = audioElRef.value.currentTime;
  debouncedSave();
}

function onLoadedMetadata() {
  if (!audioElRef.value) return;
  const reported = audioElRef.value.duration;
  duration.value = Number.isFinite(reported) ? reported : 0;
  // Some browsers reset playbackRate when a new source loads.
  if (audioElRef.value.playbackRate !== playbackRate.value) {
    audioElRef.value.playbackRate = playbackRate.value;
  }
}

// No queue, so there is nothing to advance to — just stop and persist the
// finished position.
function onEnded() {
  isPlaying.value = false;
  saveToLocalStorage();
}

function onPlay() {
  isPlaying.value = true;
  // Never let two audio streams run at once.
  if (musicAudioEl.value && !musicAudioEl.value.paused) {
    musicAudioEl.value.pause();
    musicIsPlaying.value = false;
  }
}

function onAudioError() {
  toast.error('Erreur de lecture de l\'épisode.');
  isPlaying.value = false;
}

function onProgressClick(e: MouseEvent) {
  if (!progressBarRef.value || displayDuration.value <= 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  seek(ratio * displayDuration.value);
}

function onRateChange(e: Event) {
  setPlaybackRate(Number((e.target as HTMLSelectElement).value));
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

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z\'></path><path d=\'M19 10v2a7 7 0 0 1-14 0v-2\'></path><line x1=\'12\' y1=\'19\' x2=\'12\' y2=\'23\'></line><line x1=\'8\' y1=\'23\' x2=\'16\' y2=\'23\'></line></svg>';

const handleCoverError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) {
    target.src = fallbackCover;
  }
};

watch(audioElRef, (el) => {
  audioEl.value = el;
}, { immediate: true });

onMounted(() => {
  restoreFromLocalStorage();
});
</script>

<style scoped>
.podcast-mini-player-audio {
  display: none;
}

.podcast-mini-player {
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

/* When a music track is also loaded, sit above the music bar instead of
   overlapping it. */
.podcast-mini-player.is-stacked {
  bottom: 72px;
}

.podcast-mini-player-cover {
  width: 48px;
  height: 48px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
}

.podcast-mini-player-info {
  display: flex;
  flex-direction: column;
  width: 220px;
  flex-shrink: 0;
  overflow: hidden;
}

.podcast-mini-player-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.podcast-mini-player-show {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.podcast-mini-player-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.podcast-mini-player-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  display: inline-flex;
  align-items: center;
  position: relative;
  transition: color 0.2s;
}

.podcast-mini-player-btn:hover {
  color: var(--text-primary);
}

.podcast-mini-player-skip-label {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 8px;
  font-weight: 700;
  pointer-events: none;
}

.podcast-mini-player-play-btn {
  background: var(--text-primary);
  color: var(--bg-base);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  justify-content: center;
}

.podcast-mini-player-play-btn:hover {
  color: var(--bg-base);
  opacity: 0.9;
}

.podcast-mini-player-progress-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.podcast-mini-player-time {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
  width: 52px;
}

.podcast-mini-player-progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}

.podcast-mini-player-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
}

.podcast-mini-player-extra-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.podcast-mini-player-rate {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  border-radius: var(--border-radius-md);
  font-size: 12px;
  padding: 4px 6px;
  cursor: pointer;
}

.podcast-mini-player-rate:hover {
  color: var(--text-primary);
}
</style>
```

- [ ] **Step 2: Verify the project still type-checks and builds**

Run: `npx nuxt build`
Expected: build succeeds with no TypeScript/Vue compile errors. (The component is not mounted anywhere yet, so nothing visible changes.)

- [ ] **Step 3: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS — unchanged from Task 1's final run.

- [ ] **Step 4: Commit**

```bash
git add app/components/PodcastMiniPlayer.vue
git commit -m "feat: add PodcastMiniPlayer component"
```

---

## Task 3: Layout wiring + music/podcast mutual exclusion

**Files:**
- Modify: `app/layouts/default.vue` (template line ~105, line ~126; script line ~134 and ~139)
- Modify: `app/components/MusicMiniPlayer.vue` (template line 12, script after line 94)

**Interfaces:**
- Consumes (from Tasks 1–2): `usePodcastPlayer()` → `currentEpisode`, `isPlaying`, `audioEl`; the auto-imported `<PodcastMiniPlayer />` component.
- Produces: `<PodcastMiniPlayer />` mounted once app-wide; content-area bottom padding of 96px with one bar and 168px with two.

- [ ] **Step 1: Mount the component in the layout**

In `app/layouts/default.vue`, replace this line (currently line 126):

```html
    <MusicMiniPlayer />
```

with:

```html
    <MusicMiniPlayer />
    <PodcastMiniPlayer />
```

- [ ] **Step 2: Make the content-area padding account for both bars**

In `app/layouts/default.vue`, replace the `<main>` opening tag (currently line 105):

```html
      <main class="content-area" :class="{ 'has-mini-player': !!currentTrack }">
```

with:

```html
      <main
        class="content-area"
        :class="{
          'has-mini-player': !!currentTrack || !!currentEpisode,
          'has-two-mini-players': !!currentTrack && !!currentEpisode
        }"
      >
```

- [ ] **Step 3: Wire the composable into the layout's script**

In `app/layouts/default.vue`, after this import (currently line 134):

```ts
import { useMusicPlayer } from '~/composables/useMusicPlayer';
```

add:

```ts
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
```

and after this line (currently line 139):

```ts
const { currentTrack } = useMusicPlayer();
```

add:

```ts
const { currentEpisode } = usePodcastPlayer();
```

- [ ] **Step 4: Add the two-bar padding rule to the layout's styles**

In `app/layouts/default.vue`, after the existing rule:

```css
.content-area.has-mini-player {
  padding-bottom: 96px;
}
```

add:

```css
.content-area.has-two-mini-players {
  padding-bottom: 168px;
}
```

- [ ] **Step 5: Make music playback pause podcast playback**

In `app/components/MusicMiniPlayer.vue`, replace this attribute on the `<video>` element (currently line 12):

```html
    @play="isPlaying = true"
```

with:

```html
    @play="onPlay"
```

Then, in the same file's `<script setup>`, add this import next to the existing composable imports (after line 87's `import { useToast } from '~/composables/useToast';`):

```ts
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
```

and add these lines immediately after the `const toast = useToast();` line (currently line 96):

```ts
// Podcast playback is a separate <audio> element in PodcastMiniPlayer.vue;
// never let both stream at once. PodcastMiniPlayer.vue holds the mirror-image
// guard for the other direction.
const { audioEl: podcastAudioEl, isPlaying: podcastIsPlaying } = usePodcastPlayer();

function onPlay() {
  isPlaying.value = true;
  if (podcastAudioEl.value && !podcastAudioEl.value.paused) {
    podcastAudioEl.value.pause();
    podcastIsPlaying.value = false;
  }
}
```

- [ ] **Step 6: Verify the build**

Run: `npx nuxt build`
Expected: build succeeds, no compile errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — including `tests/component/useMusicPlayer.test.ts`, which must be unaffected (`onPlay` is a template handler; the composable's API is untouched).

- [ ] **Step 8: Commit**

```bash
git add app/layouts/default.vue app/components/MusicMiniPlayer.vue
git commit -m "feat: mount PodcastMiniPlayer in the default layout"
```

---

## Task 4: Play button on completed episode rows

**Files:**
- Modify: `app/pages/podcasts/index.vue` (template episode row at lines 73-87; script imports at lines 115-122; new `<style>` rule)

**Interfaces:**
- Consumes (from Task 1, exact names): `usePodcastPlayer()` → `play(episode: PlayableEpisode)`; the `PlayableEpisode` fields `id`, `title`, `show_title`, `show_cover_url`, `duration`, `local_file_path`.
- Data shapes already present in this page (verified against the real routes): each `ep` in `episodes` has `id, show_id, title, description, episode_number, season_number, duration, pub_date, download_status, local_file_path`; `show.value` has `id, title, description, author, cover_url, language, visibility`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the play button to the episode row**

In `app/pages/podcasts/index.vue`, replace the status-badge line inside the `v-for="ep in episodes"` row (currently line 83):

```html
            <span class="badge" :class="getStatusBadgeClass(ep.download_status)">{{ formatStatus(ep.download_status) }}</span>
```

with:

```html
            <button
              v-if="ep.download_status === 'completed' && ep.local_file_path"
              @click.stop="playEpisode(ep)"
              class="episode-play-btn"
              title="Lire l'épisode"
              aria-label="Lire l'épisode"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
            <span class="badge" :class="getStatusBadgeClass(ep.download_status)">{{ formatStatus(ep.download_status) }}</span>
```

- [ ] **Step 2: Wire the composable into the page's script**

In `app/pages/podcasts/index.vue`, after this import (currently line 118):

```ts
import { useAuth } from '~/composables/useAuth';
```

add:

```ts
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
```

and after this line (currently line 120):

```ts
const { isAdmin } = useAuth();
```

add:

```ts
const { play: playPodcastEpisode } = usePodcastPlayer();
```

- [ ] **Step 3: Add the `playEpisode` handler**

In `app/pages/podcasts/index.vue`, add this function immediately after the `handleEpisodeSaved` function (currently ends at line 233), before the `watch(showId, ...)` block:

```ts
// The episodes endpoint carries no cover art, so the show-level cover and
// title are passed through for the mini-player to display.
function playEpisode(ep: any) {
  if (!ep.local_file_path) return;
  playPodcastEpisode({
    id: ep.id,
    title: ep.title,
    show_title: show.value?.title,
    show_cover_url: show.value?.cover_url ?? null,
    duration: ep.duration ?? null,
    local_file_path: ep.local_file_path,
  });
}
```

- [ ] **Step 4: Add the button's styles**

In `app/pages/podcasts/index.vue`, add this rule at the end of the `<style scoped>` block, after the existing `.edit-btn:hover` rule:

```css
.episode-play-btn {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 26px;
  height: 26px;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: color 0.2s, border-color 0.2s;
  flex-shrink: 0;
}

.episode-play-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-primary);
}
```

- [ ] **Step 5: Verify the build**

Run: `npx nuxt build`
Expected: build succeeds, no compile errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — unchanged counts plus Task 1's new file.

- [ ] **Step 7: Commit**

```bash
git add app/pages/podcasts/index.vue
git commit -m "feat: add a play button to completed podcast episode rows"
```

---

## Task 5: Manual end-to-end verification

**Files:**
- Modify: none (verification only; fix-forward commits only if a check fails)

**Interfaces:**
- Consumes: everything built in Tasks 1–4.
- Produces: nothing.

Per the Global Constraints, `PodcastMiniPlayer.vue` has no automated tests — this task is how the live playback path is proven. Do not skip a check because it "obviously works".

- [ ] **Step 1: Confirm there is a real downloaded episode to play**

Run:

```bash
sqlite3 data/youkeep.db "SELECT e.id, s.title, e.title, e.duration, e.local_file_path FROM podcast_episodes e JOIN podcast_shows s ON e.show_id = s.id WHERE e.download_status='completed' LIMIT 5;"
```

Expected: at least one row, with `local_file_path` shaped like `/downloads-podcasts/<folder>/<episodeId>.mp3`.
If there are zero rows: start the dev server, go to `Settings > Podcasts`, add a feed, and download one episode before continuing. Prefer an episode longer than one hour if one exists (it exercises the `H:MM:SS` label); if none exists, note that the `H:MM:SS` branch is covered by Task 1's unit tests.

- [ ] **Step 2: Boot the dev server**

Run: `npm run dev`
Expected: Nuxt starts and prints a local URL (usually `http://localhost:3000`). Log in, then navigate to `/podcasts` and open the show with the completed episode.

- [ ] **Step 3: Verify the play button placement and gating**

Check, in the episode list:
- The completed episode row shows a round ▶ button immediately to the left of its status badge.
- Rows with `pending` / `downloading` / `failed` status show **no** play button.

- [ ] **Step 4: Verify playback starts**

Click ▶ on the completed episode.
Expected: audio starts; the mini-player appears fixed at the bottom showing the show's cover art, the episode title, and the show title; the play/pause button shows the pause icon; the elapsed time advances and the progress bar fills.

- [ ] **Step 5: Verify pause/resume and seek**

- Click the pause button → audio stops, icon flips to ▶, elapsed time freezes.
- Click it again → audio resumes from the same spot.
- Click roughly in the middle of the progress bar → audio jumps there, and the elapsed label matches the new position (this exercises the file route's HTTP Range support).

- [ ] **Step 6: Verify skip ±15s/30s and clamping**

- Click the back-skip button → the position moves back exactly 15 seconds.
- Click the forward-skip button → the position moves forward exactly 30 seconds.
- Seek to within 5 seconds of the start, click back-skip → the position clamps to `0:00`, no error.
- Seek to within 5 seconds of the end, click forward-skip → the position clamps to the total duration and does not run past it.

- [ ] **Step 7: Verify playback speed**

Set the speed `<select>` to `1.5x` → audio audibly speeds up. Set it to `0.75x` → it slows down. Set it back to `1x`.

- [ ] **Step 8: Verify time formatting**

Confirm the two time labels read `M:SS` for a sub-hour episode and `H:MM:SS` for an episode past one hour — and that neither ever shows a fractional value like `1:01:1.4`.

- [ ] **Step 9: Verify resume across a reload — and that it does NOT auto-play**

Let the episode play for ~30 seconds, note the elapsed time, then hard-reload the page (Cmd+Shift+R).
Expected: the mini-player is present with the same episode, cover, title and speed, showing the pre-reload position, and **audio is NOT playing** (paused icon). Click play → it resumes from that position, not from `0:00`.

- [ ] **Step 10: Verify resume survives navigation across spaces**

With an episode playing, navigate to `/` (video space), then to `/music`, then back to `/podcasts`.
Expected: audio never interrupts, and the mini-player stays visible on every page.

- [ ] **Step 11: Verify the corrupted-localStorage path**

In the browser devtools console, run:

```js
localStorage.setItem('podcast_player_state', '{not json');
```

then reload.
Expected: the page loads normally with no mini-player and no console exception; `localStorage.getItem('podcast_player_state')` returns `null` afterwards.

- [ ] **Step 12: Verify the playback-error path**

In the devtools console, run:

```js
localStorage.setItem('podcast_player_state', JSON.stringify({
  episode: { id: 'missing-ep', title: 'Missing file', show_title: 'A Show', show_cover_url: null, duration: 600, local_file_path: '/downloads-podcasts/a-show/missing-ep.mp3' },
  currentTime: 30,
  playbackRate: 1
}));
```

then reload and click play.
Expected: a red error toast reading "Erreur de lecture de l'épisode.", the play icon returns to ▶, the mini-player stays visible and inert, and the page does not crash. Clear the key afterwards: `localStorage.removeItem('podcast_player_state')`.

- [ ] **Step 13: Verify music/podcast mutual exclusion and bar stacking**

- Start a music track from `/music`, then go to `/podcasts` and start an episode.
  Expected: music pauses automatically; only the podcast plays; both bars are visible with the podcast bar sitting directly above the music bar (no overlap), and the page content scrolls clear of both.
- Now press play on the music bar.
  Expected: the podcast pauses automatically; only music plays.

- [ ] **Step 14: Verify no server calls happen during playback**

With the devtools Network tab open and filtered to `Fetch/XHR`, play, pause, seek and change speed.
Expected: no request to any `/api/podcasts/...` endpoint is issued by playback. The only podcast-related network traffic is the media/Range requests to `/downloads-podcasts/...`.

- [ ] **Step 15: Final regression run and commit if anything was fixed**

Run: `npm test`
Expected: PASS.

If (and only if) a check above required a code fix:

```bash
git add -A
git commit -m "fix: address findings from podcast playback UI end-to-end verification"
```

---

## Self-Review

**1. Spec coverage.**

| Spec requirement | Task |
| --- | --- |
| Persistent mini-player mounted once in `default.vue`, survives navigation | Task 2 (component), Task 3 (mount), Task 5 Step 10 (verified) |
| Play/pause | Task 1 `togglePlay()`, Task 2 template, Task 5 Step 5 |
| Seek via clickable progress bar | Task 1 `seek()`, Task 2 `onProgressClick`, Task 5 Step 5 |
| Skip ±15s/30s | Task 1 `skipBack`/`skipForward` + `clampSeekTime`, Task 2 buttons, Task 5 Step 6 |
| Playback-speed selector 0.75x–2x | Task 1 `PLAYBACK_RATES`/`setPlaybackRate`, Task 2 `<select>`, Task 5 Step 7 |
| Client-side-only resume of position **and** rate; no auto-play | Task 1 `saveToLocalStorage`/`restoreFromLocalStorage` + its "does NOT auto-play" test, Task 5 Step 9 |
| Rate carries forward to the next episode | Task 1: `playbackRate` is independent global state that `loadEpisode()` re-applies to every new source; never reset in `play()` |
| Play button on completed episode rows | Task 4, Task 5 Step 3 |
| `PlayableEpisode` interface exactly as specced | Task 1 Interfaces block |
| `<audio>` + cover/title/show name | Task 2 template |
| `H:MM:SS` past an hour, `M:SS` otherwise | Task 1 `formatPodcastTime` + tests, Task 5 Step 8 |
| `@ended` → stop, no auto-advance | Task 2 `onEnded` |
| `@error` → toast + `isPlaying = false`, stays visible/inert | Task 2 `onAudioError`, Task 5 Step 12 |
| Malformed localStorage → clear key, no-op | Task 1 tests, Task 5 Step 11 |
| Restored episode that 404s → normal error toast | Task 5 Step 12 |
| Non-Goal: no queue/prev/next/shuffle/repeat | Honored — no such state or action exists anywhere in Task 1; Task 2's controls are skip/play/skip only |
| Non-Goal: no server-side resume, no DB change | Honored — resume is the `podcast_player_state` localStorage key only; no migration in any task |
| Non-Goal: no play-count tracking | Honored — no `recordPlayIfThresholdReached` equivalent; Task 5 Step 14 actively verifies zero API calls during playback |
| Non-Goal: no video/clip mode | Honored — `<audio>` only; no `clipMode`/`has_clip`/`<video>` |
| Non-Goal: no server-file changes | Honored — the Files list of every task contains only `app/**` and `tests/**` paths |

No gaps.

**2. Placeholder scan.** No "TBD", "similar to Task N", "add error handling", or code-free code steps. Every modification step quotes the exact existing line to replace and the exact replacement; every new file is given in full. Task 5's checks each state a concrete expected observation rather than "verify it works".

**3. Type/signature consistency.** Cross-checked:
- `PlayableEpisode` field names — defined Task 1, used identically in the Task 1 tests (`episode()` factory), Task 2 template (`show_cover_url`, `show_title`, `title`, `duration`), and Task 4's `playEpisode` object literal.
- `play` / `togglePlay` / `seek` / `skipBack` / `skipForward` / `setPlaybackRate` / `saveToLocalStorage` / `restoreFromLocalStorage` — one spelling throughout; Task 4 aliases `play` to `playPodcastEpisode` in its own scope only (matching `music/index.vue:246`'s `play: playMusicTrack` convention).
- `currentEpisode` (never `currentTrack`) for podcasts; `currentTrack` in Tasks 2/3 refers only to `useMusicPlayer()`.
- `formatPodcastTime` (not `formatDuration`) everywhere in the new code, deliberately distinct from the page-local `formatDuration` that Task 4's file already contains — no shadowing.
- `useState` keys and the `podcast_player_state` localStorage key are spelled identically in Task 1's implementation, Task 1's tests, and Task 5's console snippets.

Two issues found and fixed inline while reviewing:
- `restoreFromLocalStorage()` was initially written `async` (mirroring Music's, which awaits a `$fetch`); with no server call it has nothing to await, so it is plain-sync and Task 2's `onMounted` calls it without `await`. Both are consistent now.
- The right-hand time label originally bound `duration`, which is `0` until `loadedmetadata` fires — so a restored-but-not-yet-played episode would have shown `0:00` as its total. Task 2 now uses the `displayDuration` computed (element duration, falling back to the RSS `duration`), and `progressPercent`/`onProgressClick` use the same value so the bar is never inconsistent with the label.
