# Catalog Pages Responsive Audit — Design Spec

Sub-project 2 of the app-wide responsive initiative (sub-project 1, the single-active-mini-player + player responsive rework, is done and merged). This sub-project covers the video/shorts/channels/subscriptions/playlists catalog pages.

## Goals

- Fix the confirmed bug: `app/pages/shorts.vue`'s `.shorts-page-container` computes its height as `calc(100vh - var(--header-height) - 48px)`, which does not account for the bottom padding `.content-area` reserves when a mini-player bar is active (96px, per sub-project 1's simplified single-value padding). The bottom of the shorts feed — including the currently-displayed video's controls — can be hidden behind the mini-player bar.
- Audit the other four catalog pages (`app/pages/index.vue`, `app/pages/channels.vue`, `app/pages/subscriptions.vue`, `app/pages/playlists/index.vue` + `app/pages/playlists/[id].vue`) and their shared components (`VideoCard.vue`, `ChannelVideoGrid.vue`) for similar patterns — fixed/viewport-relative heights or widths that ignore the layout's mini-player padding, or narrow-width clipping/overflow.
- Verify `ChannelSettingsDrawer.vue` (the admin-only channel-editing panel) behaves correctly at narrow widths — it currently has no `@media` rules of its own; confirm whether its shared/global drawer classes are already covered by `channels.vue`'s existing 600px breakpoint, or whether it needs its own fix.

## Non-Goals

- No rebuild of the grid layouts that already have reasonable breakpoint coverage (`index.vue`, `channels.vue`, `subscriptions.vue`, `playlists/index.vue` all already have multiple `grid-template-columns` media queries). This sub-project fixes real, confirmed bugs and audits for similar ones — it does not redesign working responsive grids from scratch.
- `app/pages/playlists/[id].vue`'s `height: 100vh` is explicitly OUT of scope — it belongs to `.modal-overlay`, a full-viewport modal backdrop that correctly covers the entire screen including the mini-player, not a page-layout bug.
- No responsive work outside these five pages and their directly-shared components — Settings, the watch page, and anything else remain future sub-projects.

## Architecture

**`shorts.vue` fix**: mirror the pattern `app/layouts/default.vue` already uses to know whether a mini-player is active (`!!currentTrack || !!currentEpisode` from `useMusicPlayer()`/`usePodcastPlayer()`). `.shorts-page-container`'s height calculation gains a conditional extra subtraction (96px) when either composable reports active content, keeping the feed's visible area correctly bounded above the mini-player bar rather than hard-coding a viewport-relative value that has no knowledge of it.

**Audit methodology**: for each of the remaining four pages plus `VideoCard.vue`/`ChannelVideoGrid.vue`/`ChannelSettingsDrawer.vue`, search for: any `100vh`/`100dvh`/hardcoded pixel height on a scrollable or content-bearing element that doesn't account for `.content-area`'s padding; any fixed pixel width that could overflow a narrow viewport without a corresponding media query; any interactive control that could become unreachable (off-screen, zero-size) at a supported narrow width. Findings become concrete fix tasks in the implementation plan — a page with nothing wrong is left untouched, not "improved" speculatively.

## Verification

Given this codebase's history with CSS-responsive review needing real measurement (the mini-player sub-project needed 3 rounds before a genuine browser width-sweep caught what CSS-reading alone missed), every fix in this sub-project is verified the same way: actual rendered layout measurement at a swept range of widths, not just a code read. The `shorts.vue` fix is specifically verified both with and without an active mini-player, confirming the currently-displayed short's controls stay visible and clickable in both states, at multiple widths.

## Testing

No automated tests exist for these pages today (established convention — catalog/navigation UI is verified manually, no Vue component tests for full pages). The implementation plan's final task is manual verification: a real-browser width sweep across the fixed page(s) and any audit findings, plus confirmation that pages found to have no issues were correctly left unmodified.
