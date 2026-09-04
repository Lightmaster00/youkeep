# Single Active Mini-Player + Player Responsive Rework — Design Spec

Sub-project 1 of a broader "app-wide responsive pass," decomposed at brainstorm time because the full scope ("toute l'app") is too large for a single spec. This sub-project covers the mini-player system specifically — the piece that triggered the request. Later sub-projects will cover the rest of the app (catalog pages, Settings, watch page, etc.), scoped and ordered separately once this one ships.

## Goals

- **Exactly one mini-player bar visible at a time.** Today `MusicMiniPlayer.vue` and `PodcastMiniPlayer.vue` are both mounted permanently in `app/layouts/default.vue` and each shows itself whenever it has loaded content (`currentTrack`/`currentEpisode` non-null), regardless of the other. They can be visible simultaneously, stacked (`.is-stacked`, `bottom: 72px` for podcast above music's `bottom: 0`). Audio is already mutually exclusive (each component's `onPlay` pauses the other's element) but the **visual stacking of two bars** is not — this sub-project removes it.
- **A genuine responsive rework of the mini-player**, not just anti-overflow patches. Redefine breakpoints now that only one bar ever needs to fit, and add a true compact/mobile mode that hides secondary controls rather than just shrinking them.

## Non-Goals

- No merge of `useMusicPlayer.ts`/`usePodcastPlayer.ts` or their components into a single unified player — they stay architecturally separate, as they are today.
- No UI affordance to switch to the hidden (paused, in-memory) content from within the visible bar — switching back means visiting `/music` or `/podcasts` and pressing play there, which naturally re-activates that content and re-swaps the visible bar.
- No responsive work on anything outside the mini-player system (catalog pages, Settings, watch page, etc.) — tracked as separate future sub-projects.
- No change to the existing per-composable resume/localStorage mechanics (`saveToLocalStorage`/`restoreFromLocalStorage` in each composable) beyond adding the one new field described below.

## Architecture

A small coordination layer on top of the two existing, unchanged composables:

**New `app/composables/useActiveMiniPlayer.ts`**: shared state `activeType: Ref<'music' | 'podcast' | null>` (Nuxt `useState`), persisted to `localStorage` under `active_mini_player_type`. Exposes `setActive(type)` (writes state + localStorage) and `restoreActiveType()` (reads the persisted value into state on mount, called once from `app/layouts/default.vue`'s `onMounted`, alongside the two players' own restore calls).

**Activation hook**: `useMusicPlayer.ts`'s `play()` and `usePodcastPlayer.ts`'s `play()` each call `useActiveMiniPlayer().setActive('music' | 'podcast')` as their first action. This is the only place activation happens — `togglePlay()` (pause/resume of whatever's already showing) does not change which type is active, since it only ever operates on the currently-visible bar.

**Visibility rule**, evaluated in each component's root `v-if`:
- Podcast bar shows when: `currentEpisode` is loaded AND (`activeType === 'podcast'` OR music has nothing loaded).
- Music bar shows when: `currentTrack` is loaded AND (`activeType === 'music'` OR podcast has nothing loaded).

This covers all three states correctly: only one type loaded → it always shows; both loaded → only the most-recently-activated one shows, the other stays loaded-but-hidden, paused, ready to resume the moment the user presses play on it again from its own page.

**Tie-break for pre-existing sessions**: if both composables restore a session from localStorage but `active_mini_player_type` was never set (e.g. first load after this feature ships, or a genuinely ambiguous state), neither bar would show under the rule above. Fix: each composable's existing localStorage payload gains one new field, `lastPlayedAt: number` (epoch ms, set whenever `play()`/`togglePlay()` starts playback), and `restoreActiveType()` falls back to comparing the two composables' `lastPlayedAt` values (whichever is more recent wins) only when the `active_mini_player_type` key itself is absent.

**Layout simplification**: `app/layouts/default.vue` drops `.is-stacked` handling and the `has-two-mini-players` padding class entirely — content padding becomes a single fixed value (one bar's height) whenever `!!currentTrack || !!currentEpisode`, matching the pre-two-bar-stacking behavior. `useActiveMiniPlayer().restoreActiveType()` is called in `onMounted` alongside the existing `useMusicPlayer()`/`usePodcastPlayer()` restore calls.

## Responsive Breakpoints

Redefined now that only one bar is ever laid out at once (no more reserving space for a second stacked bar):

- **Wide (desktop, no media query)**: current full layout, unchanged.
- **Medium (`≤ 900px`)**: consolidates the existing anti-overflow adjustments (previously split across 640px for podcast and 800px for music) into one shared threshold — shrunk cover art, tighter info column, compact rate selector. No longer needs to account for a second bar's width budget.
- **Compact/mobile (`≤ 480px`)**: new true compact mode. Always visible: cover art, title (single line, truncated), play/pause, clickable seek bar. Hidden entirely (not shrunk): skip ±15s/30s and the speed selector (podcast); shuffle/repeat/radio-station/volume (music).

## Error Handling

No new error states. Existing playback-error toast + `isPlaying = false` behavior is unchanged — only bar visibility logic changes. One edge case made explicit: once a bar has shown due to activation, it stays visible through pause/end (a `currentTrack`/`currentEpisode` value never auto-nulls itself) until the *other* type is explicitly activated via its own `play()` call.

## Testing

`useActiveMiniPlayer.ts` contains genuinely pure/testable logic (the `lastPlayedAt` tie-break comparison, the activation/localStorage round-trip) and gets real unit tests, following this project's established convention (mirrors `usePodcastPlayer.ts`'s own test file). `MusicMiniPlayer.vue`/`PodcastMiniPlayer.vue` remain untested by automation (live playback UI, per established convention) — verified manually in the plan's final task, specifically confirming: exactly one bar visible in every combination of loaded/active state, no simultaneous audio, and the three responsive breakpoints behave as specified.
