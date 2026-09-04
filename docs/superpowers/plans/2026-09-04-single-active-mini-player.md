# Single Active Mini-Player + Player Responsive Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make exactly one mini-player bar visible at a time (the most recently activated one), and rework both mini-players' responsive CSS into three real breakpoints — desktop, medium (≤900px), and a true compact/mobile mode (≤480px) that hides secondary controls entirely.

**Architecture:** A thin coordination layer on top of the two existing, architecturally separate composables. A new `app/composables/useActiveMiniPlayer.ts` holds `activeType: Ref<'music' | 'podcast' | null>` in Nuxt `useState`, persisted under the `active_mini_player_type` localStorage key. Each player composable's `play()` calls `setActive()` as its first action and stamps a new `lastPlayedAt` field into its own existing localStorage payload; `restoreActiveType()` (called from `app/layouts/default.vue`'s `onMounted`) reads the persisted active type and falls back to comparing the two `lastPlayedAt` stamps for sessions that predate this feature. Each component's root `v-if` then gates on `activeType`, so only one bar mounts its DOM while both `<audio>`/`<video>` elements stay mounted and paused. The layout drops its two-bar stacking/padding logic, which frees enough horizontal budget to redefine both components' breakpoints.

**Tech Stack:** Nuxt 4 (auto-imported `useState`), Vue 3 `<script setup lang="ts">`, plain CSS media queries in `<style scoped>`, Vitest 4 with the `component` project (`environment: 'nuxt'`, `@nuxt/test-utils/runtime`'s `mountSuspended`).

## Global Constraints

- No merge of useMusicPlayer.ts/usePodcastPlayer.ts or their components into a single unified player — they stay architecturally separate.
- No UI affordance to switch to the hidden (paused, in-memory) content from within the visible bar.
- No responsive work outside the mini-player system (catalog pages, Settings, watch page, etc.) — separate future sub-projects.
- No change to existing resume/localStorage mechanics beyond adding the one new lastPlayedAt field to each composable's existing payload shape.
- useActiveMiniPlayer.ts's pure logic (the lastPlayedAt tie-break comparison, the activation/localStorage round-trip) gets real unit tests, following the established convention (mirror tests/component/usePodcastPlayer.test.ts's style). MusicMiniPlayer.vue/PodcastMiniPlayer.vue remain untested by automation — verified manually in the final task.
- Responsive breakpoints: wide/desktop unchanged (no media query); medium consolidated to a single ≤900px threshold (replacing the separate 640px podcast / 800px music thresholds); new compact/mobile ≤480px threshold that HIDES ENTIRELY (not just shrinks) skip ±15s/30s + speed selector (podcast) and shuffle/repeat/radio/volume (music), while always keeping cover art, truncated single-line title, play/pause, and the seek bar visible and usable.

---

## Resolved spec/reality discrepancies (read this first)

These were resolved by reading the actual current code, not the spec's sketch. Do not "fix" them back.

**1. `default.vue` does NOT currently call the players' restore functions.**
The spec says `restoreActiveType()` is called "from `app/layouts/default.vue`'s `onMounted`, alongside the two players' own restore calls". There are no such calls in `default.vue`. Each component owns its own restore: `MusicMiniPlayer.vue`'s `onMounted` does `audioEl.value = audioElRef.value; await restoreFromLocalStorage();` and `PodcastMiniPlayer.vue`'s `onMounted` does the same synchronously. Resolution: `restoreActiveType()` still goes in `default.vue`'s `onMounted` (it is layout-level coordination state, not either player's), it just is not "alongside" anything. Note `default.vue` has **three** separate `onMounted(...)` blocks (around lines 175, 216, 257); add the call to the **first** one, which already does mount-time init. Vue runs child `onMounted` before parent `onMounted`, so both players have already kicked off their restores by then.

**2. There is a brief, accepted startup swap when a music session and a podcast session are both persisted.**
`useMusicPlayer.restoreFromLocalStorage()` is `async` (it re-hydrates the queue through `POST /api/music/tracks/by-ids`), while the podcast one is synchronous. So on a cold load with `activeType === 'music'`, there is a window (one local API round-trip, typically <150ms) where `currentTrack` is still `null` and the podcast bar's `|| !currentTrack` fallback is briefly true, showing the podcast bar before it swaps to the music bar. This was considered and deliberately accepted rather than adding race-tracking state: both bars are `bottom: 0`, so the worst case is a sub-200ms *swap*, never two bars at once — the actual goal of this sub-project is never violated. Alternatives (a `restorePending` flag, or gating the fallback on persisted-session presence instead of the live ref) were rejected because they break the self-healing property: if music's restore genuinely fails, the literal spec rule still falls back to showing the podcast bar, whereas the persisted-session variant would leave *no* bar visible. Task 5 explicitly checks for this swap and confirms it is a swap, not a stack.

**3. `restoreActiveType()`'s fallback chain needs a third rung the spec does not mention.**
The spec's tie-break compares the two `lastPlayedAt` values. But sessions saved *before* this feature ships have no `lastPlayedAt` at all, so the comparison yields nothing and `activeType` stays `null` — which, under the visibility rule, hides **both** bars when both sessions restored. That is exactly the bug the tie-break exists to prevent. Resolution: the chain is (a) the `active_mini_player_type` key, (b) the `lastPlayedAt` comparison, (c) **presence fallback** — if a `music_player_state` entry exists pick `'music'`, else if a `podcast_player_state` entry exists pick `'podcast'`, (d) `null`. Rung (c) is what actually covers the legacy case.

**4. `useActiveMiniPlayer.ts` re-declares the other two composables' localStorage key strings.**
`music_player_state` and `podcast_player_state` are module-private `const STORAGE_KEY` in their respective files and are not exported. Exporting them would be a change to those composables' public surface for no benefit. Resolution: `useActiveMiniPlayer.ts` declares its own `MUSIC_STORAGE_KEY`/`PODCAST_STORAGE_KEY` constants with a comment pointing at the source of truth. This also keeps the dependency one-directional (`useMusicPlayer`/`usePodcastPlayer` → `useActiveMiniPlayer`, never back), so there is no import cycle.

**5. No existing test asserts the exact saved localStorage object shape, so adding `lastPlayedAt` breaks nothing.**
Verified by reading both test files. `tests/component/useMusicPlayer.test.ts` never touches `localStorage` at all. `tests/component/usePodcastPlayer.test.ts` touches it in six places but only ever via property access (`saved.playbackRate`) or `toBeNull()`/`not.toBeNull()` — never `toEqual` on the whole object. Task 2 therefore adds tests rather than repairing any. It does add one hygiene line to `usePodcastPlayer.test.ts`'s `beforeEach` (clearing the new `active_mini_player_type` key), because `play()` now writes it.

**6. The music clip `<video>` element must be hidden when the music bar is hidden.**
`.mini-player-video` lives *outside* the `v-if`'d bar (deliberately — the media element must stay mounted so hidden content stays loaded and paused) and is shown purely by `:style="{ opacity: clipMode ? 1 : 0 }"`. With the new visibility rule, a user who leaves clip mode on and then activates a podcast would be left with a floating 48px video square over the podcast bar. Task 3 binds its opacity/pointer-events to `clipMode && showBar` instead.

**7. The podcast skip buttons need a class of their own.**
Compact mode must hide skip ±15/30 but keep play/pause, and all three are currently `.podcast-mini-player-btn`. Task 4 adds `podcast-mini-player-skip-btn` to the two skip buttons in the template — a template change inside an otherwise CSS-only task.

---

## Verified breakpoint math

Widths are derived from the **current** CSS in both files. Method: sum every `flex-shrink: 0` sibling plus the bar's horizontal padding plus the inter-child gaps; whatever is left is the width of `.…-progress-row` (the only `flex: 1` child). The row's own content minimum is `2 × time-label width + 2 × row gap + progress-bar min-width (24px)`; below that, children overflow the fixed-position bar and get pushed off-screen.

### Calibration — does the model reproduce the already-verified numbers?

Music, desktop, with a clip loaded (the widest state, which is what the last fix round measured):

`24×2 padding + 5×16 gaps + 48 cover + 180 info + 28 clip-toggle + 108 controls (30+32+30+2×8) + 188 extra-controls (3×28 + 80 volume + 3×8 gaps)` = **680px fixed**.
Row content minimum = `2×36 + 2×8 + 24` = **112px**.
→ music's desktop layout breaks at **W = 792px**.

The existing in-code comment says the break is "up to ~795px depending on state, e.g. with a clip loaded". The model reproduces the previously hand-verified figure to within 3px, so it is trustworthy for the rest of this section.

### Is 900px safe as the new medium threshold?

| Component | Desktop fixed width | Row minimum | Desktop breaks at | Margin below 901px |
| --- | --- | --- | --- | --- |
| Music (clip loaded) | 680px | 112px | **792px** | 109px |
| Music (no clip) | 636px | 112px | 748px | 153px |
| Podcast | 552px | 144px | **696px** | 205px |

At W = 901px (last pixel of desktop), the seek bar itself measures **133px** for music-with-clip and **229px** for podcast. Both comfortable.

**Conclusion: 900px holds.** It fires ~108px *before* the worst-case desktop break, so it cannot reintroduce either prior bug. Raising the threshold from 800/640 to 900 is safe because it makes desktop layout apply to a *narrower* range, never a wider one. No adjustment to the spec's suggested value is needed.

### Does the medium block itself survive down to 481px?

This is the part the spec's suggested value does *not* automatically guarantee — medium must now cover the whole 481–900px range on its own, where previously the 640/800px blocks only had to reach the viewport floor with `extra-controls` already hidden.

**Podcast medium** (`padding 0 10px`, `gap 8px`, cover 36, info 96, controls 90 = 26+30+26+2×4, compact rate select ≈50):
fixed = **324px**; time labels 42px, row gap 6px.

| W | row | seek bar |
| --- | --- | --- |
| 900 | 576 | 480 |
| 768 | 444 | 348 |
| 600 | 276 | 180 |
| 481 | 157 | **61** |

Row content minimum is `2×42 + 2×6 + 24` = 120px ≤ 157. Fits with room to spare.

**Music medium** — this one does *not* fit with everything on screen. Keeping the volume slider costs `80 + 6` = 86px, giving fixed = 444px and a row of **37px** at W = 481 against a 96px content minimum: a **59px overflow**, i.e. exactly the "controls pushed off-screen" bug. So the medium block **must** hide the volume slider (and, as today, the clip toggle). With `padding 0 10px`, `gap 8px`, cover 36, info 96, controls 90, extra-controls 84 (3 × `4+4+16` buttons + 2×6 gaps):
fixed = **358px**; time labels 30px, row gap 6px.

| W | row | seek bar |
| --- | --- | --- |
| 900 | 542 | 470 |
| 768 | 410 | 338 |
| 600 | 242 | 170 |
| 481 | 123 | **51** |

Row content minimum is `2×30 + 2×6 + 24` = 96px ≤ 123. Fits.

> **This is a deliberate departure from the spec's wording.** The spec lists medium as "shrunk cover art, tighter info column, compact rate selector" and puts volume in the *compact* hide-list. The arithmetic above shows volume cannot survive to 481px, so it is hidden at medium instead. The compact requirement ("shuffle/repeat/radio/volume hidden entirely") is still satisfied — strictly so, since volume is hidden across a wider range than required. The clip toggle is likewise hidden at medium, matching what the current 800px block already does.

### Compact (≤480px)

**Podcast compact** (`padding 0 8px`, `gap 6px`, cover 32, info 84 title-only, skip buttons + rate select hidden, play button 30):
fixed = **180px**; time labels 40px, row gap 4px. Row content minimum = 112px.

| W | row | seek bar |
| --- | --- | --- |
| 480 | 300 | 212 |
| 390 (iPhone 14) | 210 | 122 |
| 360 (common Android) | 180 | 92 |
| 320 (smallest realistic) | 140 | 52 |

**Music compact** (`padding 0 8px`, `gap 6px`, cover 32, info 72 title-only, extra-controls hidden, prev/play/next kept = 90):
fixed = **228px**; time labels 28px (`"12:34"` at 10px ≈ 28px), row gap 4px. Row content minimum = 88px.

| W | row | seek bar |
| --- | --- | --- |
| 480 | 252 | 188 |
| 390 | 162 | 98 |
| 360 | 132 | 68 |
| 320 | 92 | **28** |

320px is the floor: the seek bar lands at 28px, just above its 24px `min-width`. Below ~316px the music bar would overflow — no shipping phone is that narrow, and the spec's "always keep the seek bar usable" is met at every real width. (Music keeps prev/next at compact because the spec's compact list only names shuffle/repeat/radio/volume; the table shows they fit.)

### Removed constraint that made all of this possible

Bar height stays 72px at every breakpoint, and only one bar is ever laid out, so `.content-area`'s bottom padding collapses to the single `96px` value and `.podcast-mini-player.is-stacked { bottom: 72px }` disappears. No vertical budget calculation is needed anywhere.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/composables/useActiveMiniPlayer.ts` (create) | `activeType` state, `setActive()`, `restoreActiveType()`, and two exported pure helpers. |
| `tests/component/useActiveMiniPlayer.test.ts` (create) | Unit tests for the pure helpers and the activation/restore round-trip. |
| `app/composables/useMusicPlayer.ts` (modify) | `setActive('music')` in `play()`; `lastPlayedAt` state + payload field. |
| `app/composables/usePodcastPlayer.ts` (modify) | `setActive('podcast')` in `play()`; `lastPlayedAt` state + payload field. |
| `tests/component/usePodcastPlayer.test.ts` (modify) | One `beforeEach` hygiene line for the new localStorage key. |
| `app/components/MusicMiniPlayer.vue` (modify) | `showBar` visibility gate, clip-video gate, new breakpoints. |
| `app/components/PodcastMiniPlayer.vue` (modify) | `showBar` visibility gate, drop `.is-stacked`, skip-button class, new breakpoints. |
| `app/layouts/default.vue` (modify) | Call `restoreActiveType()`; collapse the two padding classes into one. |

---

## Task 1: `useActiveMiniPlayer.ts` composable + unit tests

**Files:**
- Create: `app/composables/useActiveMiniPlayer.ts`
- Test: `tests/component/useActiveMiniPlayer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Uses Nuxt's auto-imported `useState`. Reads (never writes) the `music_player_state` and `podcast_player_state` localStorage keys owned by `useMusicPlayer.ts`/`usePodcastPlayer.ts`.
- Produces (later tasks rely on these exact names/types):
  - `export type ActiveMiniPlayerType = 'music' | 'podcast'`
  - `export function readLastPlayedAt(rawJson: string | null): number | null` — pure; parses a stored player payload and returns its `lastPlayedAt` if it is a finite number, else `null`.
  - `export function pickActiveFromLastPlayedAt(musicLastPlayedAt: number | null, podcastLastPlayedAt: number | null): ActiveMiniPlayerType | null` — pure tie-break; more recent wins, ties go to `'music'`.
  - `export function useActiveMiniPlayer()` returning `{ activeType: Ref<ActiveMiniPlayerType | null>, setActive(type: ActiveMiniPlayerType): void, restoreActiveType(): void }`
  - `useState` key (stable, referenced by tests): `active_mini_player_type`. localStorage key: `active_mini_player_type`.

- [ ] **Step 1: Write the failing test file**

Create `tests/component/useActiveMiniPlayer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/component/useActiveMiniPlayer.test.ts`
Expected: FAIL — the file `app/composables/useActiveMiniPlayer.ts` does not exist, so the import cannot resolve.

- [ ] **Step 3: Write the composable**

Create `app/composables/useActiveMiniPlayer.ts`:

```ts
export type ActiveMiniPlayerType = 'music' | 'podcast';

const STORAGE_KEY = 'active_mini_player_type';

// Re-declared rather than imported: these are module-private constants in
// useMusicPlayer.ts / usePodcastPlayer.ts and exporting them would widen those
// composables' public surface for no benefit. Keeping the dependency
// one-directional (players -> this file, never back) also rules out an import
// cycle, since both players call setActive() from their play().
const MUSIC_STORAGE_KEY = 'music_player_state';
const PODCAST_STORAGE_KEY = 'podcast_player_state';

// Pure. Reads the `lastPlayedAt` stamp out of a raw player payload. Returns
// null for an absent key, malformed JSON, or a legacy payload saved before
// this field existed — all three mean "this side has no claim".
export function readLastPlayedAt(rawJson: string | null): number | null {
  if (!rawJson) return null;
  let saved: any;
  try {
    saved = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!saved || typeof saved.lastPlayedAt !== 'number' || !Number.isFinite(saved.lastPlayedAt)) {
    return null;
  }
  return saved.lastPlayedAt;
}

// Pure. Whichever type played most recently wins. An exact tie is
// vanishingly unlikely with epoch-ms stamps but must still be deterministic,
// so it resolves to 'music'.
export function pickActiveFromLastPlayedAt(
  musicLastPlayedAt: number | null,
  podcastLastPlayedAt: number | null
): ActiveMiniPlayerType | null {
  if (musicLastPlayedAt === null && podcastLastPlayedAt === null) return null;
  if (podcastLastPlayedAt === null) return 'music';
  if (musicLastPlayedAt === null) return 'podcast';
  return podcastLastPlayedAt > musicLastPlayedAt ? 'podcast' : 'music';
}

export function useActiveMiniPlayer() {
  const activeType = useState<ActiveMiniPlayerType | null>('active_mini_player_type', () => null);

  function setActive(type: ActiveMiniPlayerType) {
    activeType.value = type;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, type);
    }
  }

  // Called once from app/layouts/default.vue's onMounted. Four rungs, in
  // order: (a) the persisted active type; (b) the lastPlayedAt tie-break, for
  // a session where the active key was never written; (c) whichever player
  // has a persisted session at all, which is the only rung that covers
  // sessions saved before lastPlayedAt existed; (d) null.
  function restoreActiveType() {
    if (typeof window === 'undefined') return;

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'music' || stored === 'podcast') {
      activeType.value = stored;
      return;
    }
    if (stored !== null) window.localStorage.removeItem(STORAGE_KEY);

    const musicRaw = window.localStorage.getItem(MUSIC_STORAGE_KEY);
    const podcastRaw = window.localStorage.getItem(PODCAST_STORAGE_KEY);

    const byStamp = pickActiveFromLastPlayedAt(readLastPlayedAt(musicRaw), readLastPlayedAt(podcastRaw));
    if (byStamp) {
      activeType.value = byStamp;
      return;
    }

    if (musicRaw) {
      activeType.value = 'music';
      return;
    }
    if (podcastRaw) {
      activeType.value = 'podcast';
      return;
    }
    activeType.value = null;
  }

  return { activeType, setActive, restoreActiveType };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/component/useActiveMiniPlayer.test.ts`
Expected: PASS — 18 tests across 3 describe blocks.

- [ ] **Step 5: Run the whole suite to confirm nothing else moved**

Run: `npm test`
Expected: PASS — the new file is additive and nothing imports it yet.

- [ ] **Step 6: Commit**

```bash
git add app/composables/useActiveMiniPlayer.ts tests/component/useActiveMiniPlayer.test.ts
git commit -m "feat: add useActiveMiniPlayer composable for single-active-bar coordination"
```

---

## Task 2: Wire activation + `lastPlayedAt` into both player composables

**Files:**
- Modify: `app/composables/useMusicPlayer.ts` (`play()` at lines 61-76, `togglePlay()` at 93-101, `saveToLocalStorage()` at 199-210, `restoreFromLocalStorage()` at 212-271, the state block at 17-28, and the return object at 273-278)
- Modify: `app/composables/usePodcastPlayer.ts` (`play()` at lines 143-159, `togglePlay()` at 161-169, `saveToLocalStorage()` at 193-201, `restoreFromLocalStorage()` at 206-234, the state block at 68-73, and the return object at 236-240)
- Test: `tests/component/useMusicPlayer.test.ts` (add cases), `tests/component/usePodcastPlayer.test.ts` (add cases + one `beforeEach` line)

**Interfaces:**
- Consumes (from Task 1, already on disk): `useActiveMiniPlayer()` returning `{ activeType, setActive, restoreActiveType }`, and the type `ActiveMiniPlayerType = 'music' | 'podcast'`. Only `setActive` is used here.
- Produces (Task 3 relies on these):
  - `useMusicPlayer()`'s return object gains `lastPlayedAt: Ref<number>`; everything else is unchanged, including `currentTrack: Ref<PlayableTrack | null>`.
  - `usePodcastPlayer()`'s return object gains `lastPlayedAt: Ref<number>`; everything else is unchanged, including `currentEpisode: Ref<PlayableEpisode | null>`.
  - New `useState` keys: `music_player_last_played_at`, `podcast_player_last_played_at`.
  - localStorage payload shapes gain exactly one field each: `music_player_state` → `{ trackId, queueTrackIds, currentIndex, currentTime, shuffleOn, repeatMode, lastPlayedAt }`; `podcast_player_state` → `{ episode, currentTime, playbackRate, lastPlayedAt }`.
  - Calling either `play()` now synchronously sets `activeType` to that player's type and flushes that player's localStorage entry.

- [ ] **Step 1: Write the failing tests for the music side**

Append this describe block to `tests/component/useMusicPlayer.test.ts`, immediately before the file's final closing `});`:

```ts
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

    it('marks music active and stamps lastPlayedAt when play() is called', () => {
      const before = Date.now();
      player.play(track('1'), [track('1'), track('2')]);
      expect(useActiveMiniPlayer().activeType.value).toBe('music');
      expect(player.lastPlayedAt.value).toBeGreaterThanOrEqual(before);
    });

    it('persists lastPlayedAt into the saved payload', () => {
      player.play(track('1'), [track('1')]);
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
```

Add the import at the top of that file, next to the existing `useMusicPlayer` import:

```ts
import { useActiveMiniPlayer } from '../../app/composables/useActiveMiniPlayer';
```

Add these three lines to that file's existing `beforeEach`, after `player.repeatMode.value = 'off';`:

```ts
    player.lastPlayedAt.value = 0;
    window.localStorage.removeItem('music_player_state');
    window.localStorage.removeItem('active_mini_player_type');
```

> The file already defines a `track(id)` factory — reuse it exactly as the surrounding `describe` blocks do. `play()` does not need a real element for the first two tests: with `audioEl.value === null` it still sets state and calls `saveToLocalStorage()`.

- [ ] **Step 2: Write the failing tests for the podcast side**

Add this line to `tests/component/usePodcastPlayer.test.ts`'s `beforeEach`, right after `window.localStorage.removeItem(STORAGE_KEY);`:

```ts
    window.localStorage.removeItem(ACTIVE_KEY);
```

Add near the file's other top-level constants (after `const STORAGE_KEY = 'podcast_player_state';`):

```ts
const ACTIVE_KEY = 'active_mini_player_type';
```

Add this import next to the existing `usePodcastPlayer` import:

```ts
import { useActiveMiniPlayer } from '../../app/composables/useActiveMiniPlayer';
```

Append this describe block inside the existing `describe('usePodcastPlayer', ...)`, just before its closing `});`:

```ts
  describe('activation and lastPlayedAt', () => {
    it('marks podcast active and stamps lastPlayedAt when play() is called', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      const before = Date.now();
      player.play(episode('e1'));
      expect(useActiveMiniPlayer().activeType.value).toBe('podcast');
      expect(player.lastPlayedAt.value).toBeGreaterThanOrEqual(before);
    });

    it('persists lastPlayedAt into the saved payload', () => {
      const el = fakeAudio();
      player.audioEl.value = el as unknown as HTMLMediaElement;
      player.play(episode('e1'));
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
```

Add `player.lastPlayedAt.value = 0;` to that file's `beforeEach` alongside the other state resets.

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run tests/component/useMusicPlayer.test.ts tests/component/usePodcastPlayer.test.ts`
Expected: FAIL — `player.lastPlayedAt` is `undefined` (`Cannot read properties of undefined (reading 'value')`).

- [ ] **Step 4: Implement the music side**

In `app/composables/useMusicPlayer.ts`, add the import at the very top of the file (above `export interface PlayableTrack`):

```ts
import { useActiveMiniPlayer } from './useActiveMiniPlayer';
```

Add one state line after `const hasCountedThisPlay = ...` (line 28):

```ts
  const lastPlayedAt = useState<number>('music_player_last_played_at', () => 0);
```

Replace `play()` (lines 61-76) with:

```ts
  function play(track: PlayableTrack, tracks: PlayableTrack[]) {
    // Activation happens here and nowhere else: pressing play on a track is
    // the one gesture that means "the music bar is the bar I want to see".
    // togglePlay() deliberately does not activate, since it only ever
    // operates on the bar that is already visible.
    useActiveMiniPlayer().setActive('music');
    lastPlayedAt.value = Date.now();

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
    // Flush immediately rather than waiting for the component's debounced
    // timeupdate save, so restoreActiveType()'s tie-break has a stamp to read
    // even if the tab is closed seconds after playback starts.
    saveToLocalStorage();
  }
```

Replace `togglePlay()` (lines 93-101) with:

```ts
  function togglePlay() {
    if (!audioEl.value || !currentTrack.value) return;
    if (isPlaying.value) {
      audioEl.value.pause();
      isPlaying.value = false;
    } else {
      lastPlayedAt.value = Date.now();
      audioEl.value.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
  }
```

Replace the `state` object inside `saveToLocalStorage()` (lines 201-208) with:

```ts
    const state = {
      trackId: currentTrack.value.id,
      queueTrackIds: queue.value.map((t) => t.id),
      currentIndex: currentIndex.value,
      currentTime: currentTime.value,
      shuffleOn: shuffleOn.value,
      repeatMode: repeatMode.value,
      lastPlayedAt: lastPlayedAt.value,
    };
```

In `restoreFromLocalStorage()`, add one line immediately after `isPlaying.value = false;` (line 248):

```ts
      lastPlayedAt.value = typeof saved.lastPlayedAt === 'number' && Number.isFinite(saved.lastPlayedAt)
        ? saved.lastPlayedAt
        : 0;
```

Add `lastPlayedAt` to the returned object — change the first returned line (line 274) to:

```ts
    currentTrack, queue, currentIndex, isPlaying, currentTime, duration, audioEl, lastPlayedAt,
```

- [ ] **Step 5: Implement the podcast side**

In `app/composables/usePodcastPlayer.ts`, add the import at the very top of the file (above `export interface PlayableEpisode`):

```ts
import { useActiveMiniPlayer } from './useActiveMiniPlayer';
```

Add one state line after `const audioEl = ...` (line 73):

```ts
  const lastPlayedAt = useState<number>('podcast_player_last_played_at', () => 0);
```

Replace `play()` (lines 143-159) with:

```ts
  function play(episode: PlayableEpisode) {
    // Activation happens here and nowhere else — see the matching comment in
    // useMusicPlayer.ts's play().
    useActiveMiniPlayer().setActive('podcast');
    lastPlayedAt.value = Date.now();

    // Replaying the episode already loaded picks up where it left off (that
    // is what makes the restored "resume" state resume) — UNLESS that held
    // position is at (or within a couple seconds of) the episode's end, in
    // which case it already finished and should restart from 0 instead of
    // seeking straight back to the end. Any other episode starts from the
    // beginning.
    const resumeAt =
      currentEpisode.value?.id === episode.id && !isFinishedPosition(currentTime.value, effectiveDuration())
        ? currentTime.value
        : 0;
    loadEpisode(episode, resumeAt);
    const el = audioEl.value;
    if (el) {
      el.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
    }
    // Flush immediately — same reason as useMusicPlayer.ts's play().
    saveToLocalStorage();
  }
```

Replace `togglePlay()` (lines 161-169) with:

```ts
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
```

Replace the `state` object inside `saveToLocalStorage()` (lines 195-199) with:

```ts
    const state = {
      episode: currentEpisode.value,
      currentTime: currentTime.value,
      playbackRate: playbackRate.value,
      lastPlayedAt: lastPlayedAt.value,
    };
```

In `restoreFromLocalStorage()`, add one line immediately after `isPlaying.value = false;` (line 227):

```ts
    lastPlayedAt.value = typeof saved.lastPlayedAt === 'number' && Number.isFinite(saved.lastPlayedAt)
      ? saved.lastPlayedAt
      : 0;
```

Add `lastPlayedAt` to the returned object — change the first returned line (line 237) to:

```ts
    currentEpisode, isPlaying, currentTime, duration, playbackRate, audioEl, lastPlayedAt,
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `npx vitest run tests/component/useMusicPlayer.test.ts tests/component/usePodcastPlayer.test.ts`
Expected: PASS — including the pre-existing cases. Pay particular attention to `usePodcastPlayer.test.ts`'s "does NOT touch localStorage on a live playback error after the user pressed play", which now finds the key already written by `play()` itself — it should still pass, because `play()` is not a restore and never arms the stale-entry error listener.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS, no regressions in the server or integration projects.

- [ ] **Step 8: Commit**

```bash
git add app/composables/useMusicPlayer.ts app/composables/usePodcastPlayer.ts tests/component/useMusicPlayer.test.ts tests/component/usePodcastPlayer.test.ts
git commit -m "feat: activate the mini-player type on play() and persist lastPlayedAt"
```

---

## Task 3: Single-bar visibility in both components + layout simplification

**Files:**
- Modify: `app/components/MusicMiniPlayer.vue` (template lines 2-17, script lines 90-110)
- Modify: `app/components/PodcastMiniPlayer.vue` (template line 15, script lines 66-75, style lines 217-221)
- Modify: `app/layouts/default.vue` (template lines 105-111, script lines 137-148 and the first `onMounted` at 175-180, style lines 651-657)

**Interfaces:**
- Consumes (from Tasks 1 and 2, both already on disk):
  - `useActiveMiniPlayer()` → `{ activeType: Ref<'music' | 'podcast' | null>, setActive(type): void, restoreActiveType(): void }`. This task uses `activeType` and `restoreActiveType` only; `setActive` is already wired inside the composables by Task 2 and must not be called from any component.
  - `useMusicPlayer()` → `currentTrack: Ref<PlayableTrack | null>` (unchanged by Task 2).
  - `usePodcastPlayer()` → `currentEpisode: Ref<PlayableEpisode | null>` (unchanged by Task 2).
- Produces (Task 4 relies on these):
  - `MusicMiniPlayer.vue` exposes a `showBar` computed and its root bar element is `<div v-if="showBar" class="mini-player">`. Class names inside the bar are unchanged.
  - `PodcastMiniPlayer.vue` exposes a `showBar` computed and its root bar element is `<div v-if="showBar" class="podcast-mini-player">` — **with no `:class` binding at all**, and no `.is-stacked` rule left in its stylesheet.
  - `app/layouts/default.vue` has exactly one mini-player padding class, `.content-area.has-mini-player { padding-bottom: 96px; }`.

- [ ] **Step 1: Gate the music bar and its clip video**

In `app/components/MusicMiniPlayer.vue`, replace the `<video>` element's `:style` binding (line 4) with:

```html
    :style="{ opacity: clipMode && showBar ? 1 : 0, pointerEvents: clipMode && showBar ? 'auto' : 'none' }"
```

Replace line 17 with:

```html
  <div v-if="showBar" class="mini-player">
```

In the script, replace the `usePodcastPlayer()` destructure and the comment above it (lines 99-102) with:

```ts
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
```

Add the import next to the other composable imports at the top of the script block:

```ts
import { useActiveMiniPlayer } from '~/composables/useActiveMiniPlayer';
```

`computed` is already imported from `vue` on line 85 — no change needed there.

- [ ] **Step 2: Gate the podcast bar and drop the stacking**

In `app/components/PodcastMiniPlayer.vue`, replace line 15 with:

```html
  <div v-if="showBar" class="podcast-mini-player">
```

Replace the `useMusicPlayer()` destructure and the comment above it (lines 73-75) with:

```ts
// Read-only here: currentTrack drives the single-visible-bar rule, and the
// music element/flag are used to stop music when podcast playback starts.
const { currentTrack, audioEl: musicAudioEl, isPlaying: musicIsPlaying } = useMusicPlayer();

// Mirror of MusicMiniPlayer.vue's rule: the podcast bar shows when it has an
// episode loaded AND either podcast is the most recently activated type, or
// the music player has nothing loaded to compete with.
const { activeType } = useActiveMiniPlayer();
const showBar = computed(() => !!currentEpisode.value && (activeType.value === 'podcast' || !currentTrack.value));
```

Add the import next to the other composable imports:

```ts
import { useActiveMiniPlayer } from '~/composables/useActiveMiniPlayer';
```

Delete the `.is-stacked` rule and its comment from the stylesheet (lines 217-221):

```css
/* When a music track is also loaded, sit above the music bar instead of
   overlapping it. */
.podcast-mini-player.is-stacked {
  bottom: 72px;
}
```

- [ ] **Step 3: Simplify the layout**

In `app/layouts/default.vue`, replace the `<main>` opening tag (lines 105-111) with:

```html
      <main class="content-area" :class="{ 'has-mini-player': !!currentTrack || !!currentEpisode }">
```

Add the import next to the other composable imports (after line 142):

```ts
import { useActiveMiniPlayer } from '~/composables/useActiveMiniPlayer';
```

Add the destructure after line 148 (`const { currentEpisode } = usePodcastPlayer();`):

```ts
const { restoreActiveType } = useActiveMiniPlayer();
```

Extend the **first** `onMounted` block (lines 175-180) to:

```ts
onMounted(() => {
  if (route.query.q) {
    searchQuery.value = String(route.query.q);
  }
  checkPasswordEnforcement();
  // Runs after both mini-players' own onMounted restores (Vue mounts children
  // before parents), so by now each player has kicked off its own restore.
  restoreActiveType();
});
```

Delete the two-bar padding rule from the stylesheet (lines 655-657):

```css
.content-area.has-two-mini-players {
  padding-bottom: 168px;
}
```

- [ ] **Step 4: Verify the app still type-checks and builds**

Run: `npx nuxt build`
Expected: build succeeds with no TypeScript or template-compilation errors.

- [ ] **Step 5: Run the whole test suite**

Run: `npm test`
Expected: PASS — no component tests exist for these two `.vue` files (per Global Constraints), so this is a regression check on the composable tests only.

- [ ] **Step 6: Commit**

```bash
git add app/components/MusicMiniPlayer.vue app/components/PodcastMiniPlayer.vue app/layouts/default.vue
git commit -m "feat: show exactly one mini-player bar at a time"
```

---

## Task 4: Responsive breakpoint rework

**Files:**
- Modify: `app/components/PodcastMiniPlayer.vue` (template lines 24 and 32 — add a class; style block, replacing the `@media (max-width: 640px)` block)
- Modify: `app/components/MusicMiniPlayer.vue` (style block, replacing the `@media (max-width: 800px)` block)

**Interfaces:**
- Consumes (from Task 3, already on disk): both components' root bars are `v-if="showBar"` and only one is ever laid out at a time, so neither stylesheet needs to reserve width or vertical space for the other bar. `PodcastMiniPlayer.vue` has no `.is-stacked` rule any more.
- Produces (Task 5 verifies these): three breakpoints per component — desktop (no media query, untouched), `@media (max-width: 900px)`, `@media (max-width: 480px)`. New class `podcast-mini-player-skip-btn` on the two podcast skip buttons. No new JS.

All numbers below come from the "Verified breakpoint math" section — do not adjust them without redoing that arithmetic.

- [ ] **Step 1: Add the skip-button class to the podcast template**

In `app/components/PodcastMiniPlayer.vue`, change line 24's class attribute from `class="podcast-mini-player-btn"` to:

```html
      <button @click="skipBack" class="podcast-mini-player-btn podcast-mini-player-skip-btn" title="Reculer de 15 secondes" aria-label="Reculer de 15 secondes">
```

and line 32's to:

```html
      <button @click="skipForward" class="podcast-mini-player-btn podcast-mini-player-skip-btn" title="Avancer de 30 secondes" aria-label="Avancer de 30 secondes">
```

- [ ] **Step 2: Replace the podcast breakpoints**

In `app/components/PodcastMiniPlayer.vue`, delete the entire `@media (max-width: 640px)` block **and the comment above it** (lines 354-404 of the pre-Task-3 file) and put this in its place:

```css
/* Three breakpoints, sized against a single-bar width budget (only one
   mini-player is ever laid out now, so nothing reserves space for the other).
   Desktop (no query): fixed siblings total 552px, so the bar stops fitting
   below ~696px — 900px fires well before that.
   Medium (<= 900px): fixed siblings total 324px, leaving a 61px seek bar even
   at 481px, the narrowest width this block has to cover.
   Compact (<= 480px): skip +-15/30s and the speed selector are hidden
   outright, not shrunk; cover art, a single truncated title line, play/pause
   and the seek bar always stay. Fixed siblings total 180px, leaving a 52px
   seek bar at a 320px viewport. */
@media (max-width: 900px) {
  .podcast-mini-player {
    padding: 0 10px;
    gap: 8px;
  }

  .podcast-mini-player-cover {
    width: 36px;
    height: 36px;
  }

  .podcast-mini-player-info {
    width: 96px;
  }

  .podcast-mini-player-controls {
    gap: 4px;
  }

  .podcast-mini-player-btn {
    padding: 4px;
  }

  .podcast-mini-player-play-btn {
    width: 30px;
    height: 30px;
  }

  .podcast-mini-player-progress-row {
    gap: 6px;
  }

  .podcast-mini-player-time {
    width: 42px;
    font-size: 10px;
  }

  .podcast-mini-player-rate {
    font-size: 11px;
    padding: 3px 4px;
  }
}

@media (max-width: 480px) {
  .podcast-mini-player {
    padding: 0 8px;
    gap: 6px;
  }

  .podcast-mini-player-cover {
    width: 32px;
    height: 32px;
  }

  .podcast-mini-player-info {
    width: 84px;
  }

  /* Single truncated line: the show name is the one that goes. */
  .podcast-mini-player-show {
    display: none;
  }

  .podcast-mini-player-skip-btn {
    display: none;
  }

  .podcast-mini-player-extra-controls {
    display: none;
  }

  .podcast-mini-player-progress-row {
    gap: 4px;
  }

  .podcast-mini-player-time {
    width: 40px;
  }
}
```

- [ ] **Step 3: Replace the music breakpoints**

In `app/components/MusicMiniPlayer.vue`, delete the entire `@media (max-width: 800px)` block **and the comment above it** (lines 373-430) and put this in its place:

```css
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

  .mini-player-extra-controls {
    gap: 6px;
  }

  .mini-player-volume {
    display: none;
  }
}

@media (max-width: 480px) {
  .mini-player {
    padding: 0 8px;
    gap: 6px;
  }

  .mini-player-cover {
    width: 32px;
    height: 32px;
  }

  .mini-player-video {
    left: 8px;
    bottom: 20px;
    width: 32px;
    height: 32px;
  }

  .mini-player-info {
    width: 72px;
  }

  /* Single truncated line: the artist name is the one that goes. */
  .mini-player-artist {
    display: none;
  }

  .mini-player-extra-controls {
    display: none;
  }

  .mini-player-progress-row {
    gap: 4px;
  }

  .mini-player-time {
    width: 28px;
  }
}
```

- [ ] **Step 4: Verify the build**

Run: `npx nuxt build`
Expected: build succeeds. (CSS changes cannot fail type-checking, but the podcast template edit in Step 1 can.)

- [ ] **Step 5: Run the whole test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/MusicMiniPlayer.vue app/components/PodcastMiniPlayer.vue
git commit -m "feat: rework mini-player breakpoints into desktop/900px/480px tiers"
```

---

## Task 5: Manual end-to-end verification

**Files:**
- Modify: none expected. Any defect found here is fixed in the file that owns it and committed as a `fix:` commit.
- Test: manual, in a real browser. Per Global Constraints, `MusicMiniPlayer.vue`/`PodcastMiniPlayer.vue` carry no automated tests.

**Interfaces:**
- Consumes: the complete feature from Tasks 1-4.
- Produces: nothing consumed by later tasks — this is the final gate.

- [ ] **Step 1: Boot the dev server**

Run: `npm run dev`
Expected: Nuxt starts and prints a local URL (typically `http://localhost:3000`). Open it in a real browser (not a headless/jsdom runner — the whole point of this task is the things jsdom cannot see: layout, media queries, and real audio elements).

- [ ] **Step 2: Verify the "only one type loaded" states**

- Clear site data for the origin (DevTools → Application → Storage → Clear site data), reload. Expected: **no** mini-player bar.
- Go to `/music`, press play on a track. Expected: the music bar appears at the bottom, audio plays.
- Clear site data again, reload, go to `/podcasts`, press play on a completed episode. Expected: the podcast bar appears at the bottom, audio plays, and there is no music bar.

- [ ] **Step 3: Verify activation switching in both directions**

With a music track playing (from Step 2), go to `/podcasts` and press play on an episode.
Expected: the music bar **disappears**, the podcast bar takes its place at `bottom: 0`, music audio stops, only the episode is audible. Confirm in DevTools that `localStorage.active_mini_player_type === 'podcast'`.

Now go to `/music` and press play on a track.
Expected: the podcast bar disappears, the music bar returns, podcast audio stops, only the track is audible. `localStorage.active_mini_player_type === 'music'`.

Repeat the round trip once more. At **no** point should two bars be on screen simultaneously, and at no point should two audio streams overlap.

- [ ] **Step 4: Verify the hidden side stays loaded and resumes**

With both a track and an episode loaded and music currently visible: note the episode's position in the podcast bar before switching away. Switch to music, let it play ~10s, then go to `/podcasts` and press play on that same episode.
Expected: the episode resumes from where it left off (not from 0), confirming the hidden `<audio>` element stayed mounted with its state intact.

- [ ] **Step 5: Verify the tie-break for pre-existing sessions**

In DevTools' console, simulate a session saved before this feature shipped:

```js
localStorage.removeItem('active_mini_player_type');
const m = JSON.parse(localStorage.music_player_state); delete m.lastPlayedAt;
localStorage.music_player_state = JSON.stringify(m);
const p = JSON.parse(localStorage.podcast_player_state); delete p.lastPlayedAt;
localStorage.podcast_player_state = JSON.stringify(p);
location.reload();
```

Expected: exactly one bar shows (the music bar, by the presence-fallback rung), **never zero**. This is the specific failure mode the tie-break exists to prevent.

Then test the stamp comparison itself:

```js
localStorage.removeItem('active_mini_player_type');
const m = JSON.parse(localStorage.music_player_state); m.lastPlayedAt = 1000;
localStorage.music_player_state = JSON.stringify(m);
const p = JSON.parse(localStorage.podcast_player_state); p.lastPlayedAt = 2000;
localStorage.podcast_player_state = JSON.stringify(p);
location.reload();
```

Expected: the **podcast** bar shows. Swap the two numbers, reload, and expect the music bar.

- [ ] **Step 6: Confirm the accepted startup swap is a swap, not a stack**

With both sessions persisted and `active_mini_player_type === 'music'`, reload the page while watching the bottom of the viewport (throttle the network to "Slow 4G" in DevTools to widen the window). Expected: the podcast bar may flash for a fraction of a second before the music bar replaces it — a **swap at `bottom: 0`**, never two bars stacked. See "Resolved spec/reality discrepancies" item 2: a swap is accepted; a stack is a bug.

- [ ] **Step 7: Verify the three breakpoints for the podcast bar**

With a podcast episode loaded, use DevTools' responsive mode and step through these widths:

- **1200px** — full layout: 48px cover, wide two-line info, all three transport buttons with their 15/30 labels, speed selector, long seek bar.
- **901px** — still the desktop layout, and nothing overlaps. The seek bar should be roughly 230px.
- **899px** — medium kicks in: smaller cover, narrower info, compact speed selector. Everything still on screen.
- **700px, 600px, 481px** — the speed selector and both skip buttons are still present and reachable; nothing is clipped by the right edge; the seek bar is still clickable and seeks correctly at 481px.
- **480px** — compact: skip ±15/30 and the speed selector are **gone entirely** (not just small); cover art, one truncated title line, play/pause and the seek bar remain.
- **390px and 320px** — same as 480px, still nothing clipped, seek bar still clickable and functional.

At every width, click the seek bar and confirm playback jumps to the clicked position.

- [ ] **Step 8: Verify the three breakpoints for the music bar**

Switch to a music track (which also re-verifies Step 3) and repeat the sweep:

- **1200px** — full layout including shuffle, repeat, radio and the volume slider. If the track has a clip, the 🎬 toggle is present.
- **901px** — desktop layout intact, nothing overlapping, seek bar ~130px with a clip loaded. **Load a track that has a clip for this check** — that is the widest state and the one that regressed in the previous fix rounds.
- **899px** — medium: clip toggle and volume slider gone; shuffle, repeat and radio still present and clickable.
- **700px, 600px, 481px** — shuffle/repeat/radio still reachable, nothing clipped, seek bar clickable at 481px.
- **480px** — compact: shuffle, repeat, radio and volume all **gone entirely**; cover art, one truncated title line, prev/play/next and the seek bar remain.
- **390px and 320px** — nothing clipped; the seek bar is thin at 320px but still visible and clickable.

- [ ] **Step 9: Verify the clip video does not escape a hidden bar**

Play a music track that has a clip, turn clip mode on (🎬), confirm the video square renders over the cover-art position. Now go to `/podcasts` and press play on an episode.
Expected: the music bar disappears **and so does the video square** — no floating video over the podcast bar. (This is discrepancy item 6.)

- [ ] **Step 10: Verify the content padding**

With one bar visible, scroll a long page (`/music` or `/podcasts`) to the very bottom.
Expected: the last row of content clears the bar with a comfortable gap and is not hidden underneath it. Confirm in DevTools that `.content-area` has `padding-bottom: 96px` and that **no** element carries a `has-two-mini-players` class.

- [ ] **Step 11: Commit any fixes**

If Steps 2-10 surfaced defects, fix them in the owning file and commit:

```bash
git add -A
git commit -m "fix: address findings from single-active-mini-player manual verification"
```

If nothing was found, there is nothing to commit — the feature is complete.

---

## Self-Review

**1. Spec coverage.** Every spec section maps to a task:

| Spec requirement | Task |
| --- | --- |
| Exactly one bar visible at a time | 3 (rules), 5 (verified) |
| New `useActiveMiniPlayer.ts` with `activeType`, `setActive`, `restoreActiveType`, `active_mini_player_type` key | 1 |
| Activation hook in both `play()`s, and **not** in `togglePlay()` | 2 (implemented + explicitly tested both ways) |
| Visibility rule, verbatim from the spec, in both components' root `v-if` | 3 |
| `lastPlayedAt` field + tie-break for pre-existing sessions | 1 (logic + tests), 2 (stamping/persisting), 5 (manual) |
| Layout drops `.is-stacked` and `has-two-mini-players`, single padding value | 3 |
| `restoreActiveType()` called from `default.vue`'s `onMounted` | 3 |
| Wide/desktop unchanged | 4 (no desktop rule is touched) |
| Medium consolidated to ≤900px | 4, with the arithmetic in "Verified breakpoint math" |
| Compact ≤480px hiding skip ±15/30 + speed (podcast), shuffle/repeat/radio/volume (music) | 4 |
| Compact always keeps cover art, truncated single-line title, play/pause, usable seek bar | 4 (`…-show`/`…-artist` hidden for the single line; widths verified down to 320px) |
| No new error states | Nothing in any task touches the toast or `isPlaying = false` error paths |
| Bar stays visible through pause/end until the other type is activated | Guaranteed by the rule in Task 3 — `activeType` only changes in `play()`, verified in Task 5 Step 4 |
| Unit tests for `useActiveMiniPlayer`, none for the two `.vue` files | 1 and 2 (tests), 5 (manual gate) |

Non-Goals, each explicitly honoured: no composable/component merge (Task 2 edits each file in place; the new composable is a third, separate file); no switch-to-hidden-content affordance (no task adds a control — Task 3's Interfaces block explicitly forbids components calling `setActive`); no responsive work outside the mini-players (Task 4 touches only the two components' `<style scoped>` blocks — note `default.vue`'s existing `@media (max-width: 768px)` sidebar block is deliberately left alone); no resume/localStorage changes beyond the one field (Task 2's Interfaces block states both payload shapes exactly, one field added each).

**2. Placeholder scan.** No "TBD", "similar to Task N", "add error handling", or code-free code steps. Every CSS block, test block and function body is written out in full. Task 5's manual steps carry explicit widths, console snippets and pass criteria rather than "check it looks right".

**3. Type/signature consistency.** `ActiveMiniPlayerType`, `readLastPlayedAt`, `pickActiveFromLastPlayedAt`, `setActive`, `restoreActiveType`, `activeType`, `lastPlayedAt`, `showBar`, `podcast-mini-player-skip-btn` and both localStorage key strings are spelled identically in every task that mentions them, and the `useState` keys in Task 2 (`music_player_last_played_at`, `podcast_player_last_played_at`) do not collide with any existing key in either composable.

**Fixed during this review:**
- Task 3 originally left `MusicMiniPlayer.vue`'s `<video>` opacity bound to `clipMode` alone, which would have stranded a floating video square over the podcast bar. Now bound to `clipMode && showBar`, recorded as discrepancy item 6 and given its own verification step (Task 5, Step 9).
- Task 1's `restoreActiveType()` originally implemented only the spec's two rungs, which leaves **both** bars hidden for sessions saved before `lastPlayedAt` existed. Added the presence-fallback rung, two tests for it, discrepancy item 3, and Task 5 Step 5.
- Task 4's music medium block originally kept the volume slider per the spec's wording; the width sweep showed a 59px overflow at 481px. Volume moved to the medium hide-list, with the arithmetic and the departure from the spec documented in "Verified breakpoint math".
- Task 2 originally relied on the components' debounced save to persist `lastPlayedAt`, which loses the stamp if the tab closes within the debounce window. Both `play()`s now call `saveToLocalStorage()` directly.
- Task 2 originally did not restore `lastPlayedAt` from storage, so the first save after a page load would have reset the stamp to 0 and corrupted the tie-break. Both `restoreFromLocalStorage()`s now read it back, with a test on the podcast side.
- Task 2's music `togglePlay()` test originally reused the state left by `play()`, but `beforeEach` nulls `audioEl` and `togglePlay()` returns early without an element — the resume assertion would have failed. It now builds a minimal plain-object element locally (that file imports neither `vi` nor any shared audio fake), and `player.lastPlayedAt.value = 0` was added to its `beforeEach`.
- Task 4 originally hid the podcast skip buttons with a `:not(.podcast-mini-player-play-btn)` selector; replaced with an explicit `podcast-mini-player-skip-btn` class (Step 1) so the intent is legible and the selector cannot silently catch a future button.
