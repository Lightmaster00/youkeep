# Watch Page Responsive Audit — Design

**Status:** Approved
**Sub-project:** 5 of the app-wide responsive initiative (see `project_app_responsive_initiative.md` memory). Sub-projects 1-4 (single active mini-player, catalog pages audit, music/podcasts catalog audit, Settings responsive audit) are done and merged. The user asked for "les deux" (both remaining unscoped areas — Settings and the watch page) in one request; Settings is done, this is the second half.

## Goal

Audit the watch page and its video player for real responsive overflow bugs at narrow viewport widths, and fix whatever is confirmed. Not a speculative rebuild, and not limited to the bugs guessed at design time.

## Scope

**In scope:**
- `app/pages/watch/[id].vue` (1559 lines) — the entire watch page: video header/title, channel row, action buttons, description, chapters, comments, "up next"/recommended sidebar, playlist-queue sidebar, admin technical-details panel, and the floating in-page mini-player.
- `app/components/VideoPlayer.vue` (1045 lines) — the video player itself, including its controls bar (play/pause, volume, progress/seek, time display, speed menu, subtitles menu, and any other transport controls) and its two popup menus. Included because it is the central, most-used interactive element on the page and currently has **zero** media queries — auditing the page without it would leave the most important part unchecked.

**Out of scope:**
- Any full mobile-layout redesign — this sub-project fixes overflow, not layout philosophy. The page already has one working breakpoint (`.watch-content` collapsing from a `1fr 360px` grid to a single column at `max-width: 1200px`) that this sub-project builds on, not replaces.
- New player features, new controls, or changes to playback behavior — CSS-only overflow fixes.
- Any other page or component not directly part of rendering `/watch/[id]`.

## Approach

Same method used in sub-projects 3 and 4 — a genuine audit done live in a real browser against a real archived video (not a static CSS read, and not limited to the candidates guessed below), followed by fixes using the idioms already established and proven throughout this initiative:
- Grid track minimum: wrap a fixed `minmax(<px>, 1fr)` as `minmax(min(<px>px, 100%), 1fr)`.
- Fixed-width flex item: pair `max-width: 100%` with `min-width: 0`, or reduce the fixed width at a narrow breakpoint.
- Unwrappable horizontal row of items: `overflow-x: auto`, or `flex-wrap: wrap` where stacking is acceptable.
- A row of many icon/transport controls that can't all fit at narrow widths: reuse the exact breakpoint-tier pattern already proven for `MusicMiniPlayer.vue`/`PodcastMiniPlayer.vue` in sub-project 1 — hide secondary controls at a defined narrow tier rather than shrinking everything uniformly. Do not invent a new pattern for a bug shape this codebase has already solved.
- A `position: fixed` floating element pinned near the viewport edge: cap its width/position so it can't extend past the opposite edge at narrow viewports (a bug shape not yet seen in this initiative — the audit must determine the right fix live, most likely capping width via `max-width` relative to the viewport or repositioning at a narrow breakpoint).

## Candidate risk areas (to confirm or refute during the audit, not pre-committed fixes)

- **`.tech-grid`** (`watch/[id].vue:1055-1059`, `minmax(240px, 1fr)`, an admin-only technical-details panel): same bug shape already confirmed and fixed at 220px, 260px, 280px, 295px, and 300px elsewhere in this initiative. 240px is smaller than most of those, so by precedent it may only overflow below ~355-370px rather than at 375px+ — still worth the same free, no-op-above-threshold fix.
- **`.rec-thumbnail-wrapper`** (`watch/[id].vue:1256-1264`, a 168px fixed-width thumbnail, `flex-shrink: 0`, in the "recommended videos" sidebar list): once `.watch-content` collapses to a single column below 1200px, the sidebar's content box at narrow mobile widths (320-375px) may be too narrow for a 168px thumbnail plus any readable title text next to it, even though `.rec-info`/`.rec-title` already have `min-width: 0` and 2-line clamping. A structurally near-identical row using an inline-styled 100px thumbnail (the playlist-queue variant, `watch/[id].vue:239`) already looks correctly built (`min-width:0` + ellipsis) — worth comparing against during the audit to see if the same treatment (a narrower thumbnail at small widths) is the right fix for the 168px version too.
- **`.mini-player`** (`watch/[id].vue:1504-1508`, `position: fixed; bottom: 24px; right: 24px; width: 280px;`, an in-page floating mini-player shown when scrolling away from the main player): needs roughly 304px of viewport width (280px + 24px right offset) before it starts extending past the left edge. At exactly 320px this has ~16px of margin; any narrower and it doesn't fit. A bug shape not yet encountered in this initiative — every prior fix targeted an element inside normal document flow, not a fixed-position element pinned by an edge offset.
- **`VideoPlayer.vue`'s `.controls-row`** (`:868-874`, containing `.controls-left`/`.controls-right`, `:876-880`, which together hold roughly a dozen `.ctrl-btn` icon buttons plus a volume slider, time display, speed menu, and subtitles menu): the same "many `flex-shrink: 0` icon controls in a `justify-content: space-between` row" shape that `MusicMiniPlayer.vue`/`PodcastMiniPlayer.vue` needed a proven 3-tier breakpoint scheme to fix in sub-project 1 (desktop / medium ≤900px hiding some secondary controls / compact ≤480px hiding the rest). `VideoPlayer.vue` currently has **zero** media queries, so this is very likely the largest-radius bug in this sub-project — likely needing its own tier scheme, informed by (not necessarily identical to) the mini-players' already-proven breakpoints and hide-lists.
- **`VideoPlayer.vue`'s `.speed-menu`/`.subtitles-menu`** (`:955-961`, `:993-1001`, both `min-width: 120px`, `position: absolute; right: 0`, anchored to their trigger button): low suspicion — small popups anchored within the player's own bounds, which is normally wide enough to contain a 120px popup. Included in the audit's sweep for completeness, not expected to be a real bug.

## Non-goals

- No new automated tests — this bug class (CSS overflow) has no automated test coverage anywhere in this codebase; verification is real-browser measurement, matching every prior fix in this initiative.
- No changes to any other page, layout, or shared component beyond the two files in scope.
- No redesign of the player's control set or the page's information architecture.

## Verification

- Real-browser width sweep: 320, 375, 414, 480, 600, 900, 1200 (the existing breakpoint boundary), 1201px minimum, using a real archived video with a real title/channel/description length, real comments if any exist, and (for the admin `.tech-grid`) an admin session.
- `scrollWidth - clientWidth` on the outer content container and every candidate element, before and after any fix, at every swept width.
- For `VideoPlayer.vue`'s controls row specifically: verify at every tier that the seek/progress bar never collapses to near-zero width and no control becomes unreachable or falls outside the player's bounds — the same standard sub-project 1's Task 4 review held the mini-players to, since this is the same bug shape.
- Confirm no regression at desktop widths (≥1201px) for any element touched.
- If a candidate risk area turns out already safe, record the measurement showing so, rather than silently skipping it.
