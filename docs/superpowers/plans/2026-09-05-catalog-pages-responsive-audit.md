# Catalog Pages Responsive Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `shorts.vue`'s mini-player-blind viewport height calculation and the three confirmed narrow-viewport horizontal-overflow bugs the audit found on the catalog pages, then verify every fix by real-browser width-sweep measurement.

**Architecture:** `app/layouts/default.vue` already knows whether a mini-player bar is on screen (`!!currentTrack || !!currentEpisode`, from `useMusicPlayer()`/`usePodcastPlayer()`) and raises `.content-area`'s `padding-bottom` from 24px to 96px when it is. `shorts.vue` is the one page that pins itself to a viewport-relative height instead of flowing inside that padding, so it re-derives the same boolean with the same composables and subtracts the matching pair of padding values. The three overflow bugs are all the same shape — a fixed track/element width larger than the content box available at a 375px viewport — and are fixed in place with `min(<fixed>, 100%)` / `max-width: 100%`, which are no-ops at wide widths.

**Tech Stack:** Nuxt 4 (Vue 3 `<script setup>`, SFC scoped + unscoped `<style>`), Nitro, better-sqlite3, Vitest 4 + happy-dom + `@vue/test-utils` (`npm test` → `vitest run`).

## Global Constraints

- No rebuild of grid layouts that already have reasonable breakpoint coverage — fix confirmed bugs and audit findings only, don't redesign working responsive grids.
- playlists/[id].vue's height: 100vh belongs to .modal-overlay (a full-viewport modal backdrop) and is explicitly out of scope.
- No responsive work outside these five pages and their directly-shared components (VideoCard.vue, ChannelVideoGrid.vue, ChannelSettingsDrawer.vue) — Settings, watch page, etc. remain future sub-projects.
- Every fix is verified via real-browser width-sweep measurement, not just a CSS read — matching the established convention from sub-project 1's Task 4, given this codebase's history with CSS bugs passing superficial review.
- No automated tests expected for these pages (established convention) unless the audit surfaces a genuinely pure/testable piece of logic, in which case it should get real unit tests following this project's established pattern.

---

## Resolved spec/reality discrepancies

**The spec's `playlists/[id].vue` claim is CONFIRMED — with one mechanical nuance worth recording, so a future reader doesn't re-open it.**

The spec asserts (Non-Goals, line 14) that `app/pages/playlists/[id].vue`'s `height: 100vh` belongs to `.modal-overlay`, a full-viewport modal backdrop. I verified this directly rather than trusting it:

- `app/pages/playlists/[id].vue:303-316` is indeed the `.modal-overlay` rule, and it is indeed a fixed, full-viewport backdrop (`position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); z-index: 1000`).
- **Nuance:** no element in `[id].vue`'s own template carries `class="modal-overlay"`. The page renders `<BaseModal>` (lines 122 and 156). `app/components/BaseModal.vue`'s root element *is* `<div v-if="show" class="modal-overlay">`, and it has **no `<style>` block of its own**. Vue's scoped-CSS rule that a child component's *root node* is affected by the parent's scoped CSS is what makes `[id].vue`'s rule apply. It is live CSS, not dead CSS — it just reaches its target through the child root.
- The global `.modal-overlay` in `app/assets/css/main.css:688-698` says the same thing with `inset: 0`, so the two agree: full-viewport backdrop, correctly covering the mini-player bar too.

**Conclusion:** the constraint stands verbatim as written. No correction needed. `playlists/[id].vue`'s `100vh` is out of scope.

---

## Audit Results

This section is the completed investigation, not an instruction to investigate. Every page and shared component named in the spec was read in full on disk. The lens applied to each: (a) `100vh`/`100dvh`/hard pixel heights on scrollable or content-bearing elements that ignore `.content-area`'s mini-player padding; (b) fixed pixel widths or grid track minimums that exceed the content box at a narrow viewport with no covering media query; (c) interactive controls that could go off-screen or zero-size.

### Layout facts the audit measured against

| Fact | Source |
|---|---|
| `--header-height: 56px`, `--sidebar-collapsed-width: 72px`, `--sidebar-width: 240px` | `app/assets/css/main.css:41-43` |
| `.content-area { padding: 24px; overflow-y: auto; scrollbar-gutter: stable; display: flex; flex-direction: column }` | `app/layouts/default.vue:640-648` |
| `.content-area.has-mini-player { padding-bottom: 96px }` (single value, post sub-project 1) | `app/layouts/default.vue:650-652` |
| `has-mini-player` is bound as `!!currentTrack \|\| !!currentEpisode` | `app/layouts/default.vue:105` |
| `const { currentTrack } = useMusicPlayer(); const { currentEpisode } = usePodcastPlayer();` | `app/layouts/default.vue:142-143` |
| `useMusicPlayer()` returns `currentTrack` (confirmed current export) | `app/composables/useMusicPlayer.ts:19, 292-297` |
| `usePodcastPlayer()` returns `currentEpisode` (confirmed current export) | `app/composables/usePodcastPlayer.ts:70, 251-255` |
| Both mini-player bars are `height: 72px` at **every** breakpoint (900px/480px tiers change only `padding`/`gap`/cover size) | `MusicMiniPlayer.vue:230, 396-402, 454-460`; `PodcastMiniPlayer.vue:212, 364-368, 407-411` |
| The sidebar stays at 72px at every width — `default.vue`'s 768px query collapses labels, never the rail | `app/layouts/default.vue:654-680` |

**Derived content-box width available to a page** = `viewport − 72 (sidebar) − 48 (content-area padding) − ~15 (scrollbar-gutter: stable reserve)`.
- at 480px viewport → **~345px**
- at 375px viewport → **~240px**
- at 320px viewport → **~185px**

**Fix threshold used by this audit:** an element is treated as a bug to fix if it overflows at **375px** (the mainstream mobile viewport, and comfortably inside the band sub-project 1 already supports with its 480px mini-player tier). Elements that fit at 375px but degrade below ~340px are recorded below as "checked, documented, not fixed" so the width sweep knows to look at them without treating them as regressions.

### Per-file findings

#### 1. `app/pages/shorts.vue` — **BUG CONFIRMED (the spec's known bug)**

`app/pages/shorts.vue:546-553`:

```css
.shorts-page-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: calc(100vh - var(--header-height) - 48px);
  padding: 0;
  overflow: hidden;
}
```

The `48px` is `.content-area`'s `24px` top + `24px` bottom padding. When a mini-player is active the layout's bottom padding becomes `96px`, so the correct subtraction is `24 + 96 = 120px`. The container therefore renders **72px taller than the space it actually has**, and because `.shorts-page-container` is a flex item in a column flex container whose parent reserves 96px at the bottom, the overshoot pushes the bottom of `.smartphone-frame` under the bar. The clipped region contains `.reel-bottom-info` (channel link, title, description — `pointer-events: auto` on its children, `shorts.vue:980-984`) and `.progress-bar-thin` (the seek control, `shorts.vue:1022-1032`), i.e. real interactive controls, not just decoration.

Also confirmed: `shorts.vue`'s `<script setup>` (lines 166-168) imports **only** `vue` and `~/composables/useToast` — it does **not** currently import `useMusicPlayer`/`usePodcastPlayer`. Task 1 adds them.

No other height in `shorts.vue` is viewport-relative: `.shorts-layout-wrapper`, `.smartphone-frame`, `.shorts-feed`, `.reel-item` are all `height: 100%` chained off the container, so fixing the container fixes the whole chain. `.comments-pane` is `width: 380px` → `320px` at ≤1280px → `display: none` at ≤1024px (`shorts.vue:837-851`), so it can never overflow a narrow viewport.

#### 2. `app/pages/channels.vue` — **TWO BUGS CONFIRMED**

Note first: this file's `<style>` block is **unscoped** (line 113, plain `<style>`), and it is where the CSS for `ChannelDirectoryView.vue`, `ChannelStatsPanel.vue` and `ChannelVideoGrid.vue` lives — none of those components have `<style>` blocks. So fixes for those components' layout land in `channels.vue`, inside the plan's scope.

**Bug 2a — `.channel-grid` track minimum exceeds the mobile content box.** `channels.vue:137-141`:

```css
.channels-page .channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(295px, 1fr));
  gap: 24px;
}
```

`minmax(295px, 1fr)` never goes below 295px, so once the content box drops under 295px the single column is wider than its container. Breaks below a **~430px viewport**; at 375px it overflows by ~55px, producing a horizontal scrollbar on `.content-area` (which computes `overflow-x: auto` because `overflow-y` is `auto`). This grid is the channels directory (`ChannelDirectoryView.vue:7, 28`) — the landing view of the page. No media query anywhere in `channels.vue` touches `.channel-grid`.

**Bug 2b — `.search-box`'s fixed 260px width exceeds the mobile content box.** `channels.vue:564-574`:

```css
.channels-page .search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 12px;
  border-radius: 40px;
  height: 36px;
  width: 260px;
}
```

It is a flex item of `.filter-sort-bar` (`channels.vue:553-562`, `padding: 12px 16px`, `flex-wrap: wrap`), used by `ChannelVideoGrid.vue:5`. Budget needed: `260 + 32 = 292px`; breaks below a **~427px viewport**. Flex-shrink does not rescue it: `.search-box`'s automatic minimum size (`min-width: auto`) is floored by `.filter-input`'s intrinsic input width (`channels.vue:580-586` sets `width: 100%` but no `min-width: 0`), so it bottoms out near ~220px and still overflows at 375px. Fix is to make the shrink actually reachable and cap the width.

**Checked, no issue found, in `channels.vue`:**
- `.video-grid` — `repeat(3, 1fr)` with `@media (max-width: 1024px) → 2` and `@media (max-width: 640px) → 1` (lines 428-446). Fluid at every width.
- `.shorts-grid` — `minmax(160px, 1fr)` (line 880-884). 160 < 185 (the 320px-viewport content box), so it never overflows in the swept band.
- `.channel-stats-row` — `repeat(4, 1fr)` with `@media 900px → 2` and `@media 500px → 1` (lines 682-698). Covered.
- `.channel-detail-view` — `max-width: 1200px; width: 100%` (line 299-306). Fluid.
- `.channel-profile-header` — the `@media (max-width: 600px)` block at line 335 stacks it to a centered column. Covered.
- `.channel-card-*` — all percentage/auto sizing inside the grid cell; `.channel-card-title`/`.channel-card-desc` are ellipsis/line-clamped. No fixed widths.
- No `100vh`, `100dvh`, or `vh`-relative height appears anywhere in `channels.vue` (grepped the whole file): nothing on this page competes with `.content-area`'s mini-player padding — it is a normal scrolling page.

**Checked, documented, NOT fixed (fits at 375px):** `.summary-grid-layout` is `repeat(auto-fit, minmax(200px, 1fr))` (lines 792-796, used by `ChannelStatsPanel.vue:53`). 200px fits the 240px content box at 375px; it would only overflow below a ~335px viewport. Below the fix threshold — the width sweep records it, it is not changed.

#### 3. `app/pages/subscriptions.vue` — **ONE BUG CONFIRMED**

**Bug 3 — `.video-grid` track minimum exceeds the mobile content box.** `subscriptions.vue:296-300`:

```css
.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}
```

Same shape as Bug 2a. Breaks below a **~415px viewport**; at 375px it overflows by ~40px. This is the page's only grid and it has no media queries at all. (`subscriptions.vue` has zero `@media` rules in the entire file.)

**Checked, no issue found, in `subscriptions.vue`:**
- No `100vh`/`100dvh`/`vh` unit anywhere in the file; `.subscriptions-page` is a plain `flex column` with `gap: 24px` (lines 189-193) that flows inside `.content-area`'s padding — mini-player padding applies correctly with no intervention.
- `.channels-row` (lines 201-206) is `overflow-x: auto` by design — the subscribed-channel pill strip is an intentional horizontal scroller, and `.sub-channel-pill`'s `white-space: nowrap` (line 230) is what makes it scroll rather than wrap. Not a bug.
- `.infinite-scroll-trigger` is `width: 100%; height: 60px` (lines 285-292) — a fixed *height* on a zero-content sentinel inside normal flow, not on a scrollable/viewport-pinned container. Harmless.
- The `.video-card`/`.thumbnail-wrapper`/`.video-info` block (lines 302-410) is stale leftover CSS: `subscriptions.vue`'s template renders `<VideoCard>` (line 52), and these rules are `<style scoped>` targeting non-root descendants of a child component, so they do not apply. Dead, but not a responsive bug and out of scope for this sub-project.

#### 4. `app/pages/index.vue` — **CLEAN, no issue found**

- Grepped the whole file for `100vh`/`100dvh`/`vh` — **zero occurrences**. `.home-container` is `flex column; min-height: 100%` (lines 263-267), which respects the padded content box rather than the viewport. Nothing here competes with the mini-player padding.
- `.featured-bento` has `height: 420px` (line 292-299), a fixed height — but on a decorative hero block in normal document flow inside a *scrolling* container, not on a viewport-pinned or scrollable element. It is also already responsive: `@media (max-width: 900px)` sets `height: auto` and re-flows the grid (lines 434-447), `@media (max-width: 640px)` drops to one column (lines 449-454). Not the shorts.vue pattern.
- `.video-grid` — `repeat(4, 1fr)` → 3 @1400px → 2 @1000px → 1 @640px (lines 542-559). Full coverage.
- `.scroll-card { flex: 0 0 260px }` → `220px` @900px (lines 525-534) is a fixed width, but it lives inside `.scroll-row`, an explicit `overflow-x: auto` horizontal carousel (lines 494-504). Overflowing that container is the entire point; it cannot leak to the page.
- `.scroll-row`'s full-bleed trick — `width: calc(100% + 48px); margin-left: -24px; padding: 0 24px` — was checked arithmetically rather than assumed: with a content box of width `W`, the element starts at `−24px` (the padding box's left edge) and ends at `W + 24px` (the padding box's right edge). It exactly fills `.content-area`'s padding box and overflows the page by **0px**. Correct as written.
- `.search-channel-pill` / `.channels-row` (lines 566-587) are `flex-wrap: wrap` with intrinsically-sized pills. No fixed widths.

#### 5. `app/pages/playlists/index.vue` — **CLEAN, no issue found**

- Grepped for `100vh`/`100dvh`/`vh` — **zero occurrences**. `.playlists-container` is `width: 100%` (lines 193-196).
- `.playlists-grid` — `repeat(3, 1fr)` → 2 @992px → 1 @576px (lines 255-271). Full coverage, all-fractional tracks, no track minimum to overflow.
- `.modal-card { width: 460px; max-width: 90% }` (lines 495-503) is already narrow-safe; it is also duplicated by the global rule at `main.css:700-711`. Modal, out of scope regardless.
- `.playlist-card`, `.thumbnail-wrapper` (`aspect-ratio: 16/9; width: 100%`), `.video-info`, `.details-col` (`min-width: 0`) — all fluid.

#### 6. `app/pages/playlists/[id].vue` — **CLEAN in scope, no issue found**

- The only `100vh` in the file is `.modal-overlay` (lines 303-316) — see "Resolved spec/reality discrepancies" above. Confirmed a full-viewport modal backdrop, explicitly out of scope per the Global Constraints. **This is the only `vh` unit in the file.**
- `.playlist-grid-layout` — `grid-template-columns: 320px 1fr` with `@media (max-width: 768px) { grid-template-columns: 1fr }` (lines 401-411). The 320px sidebar track is only in play at ≥768px, where the content box is ≥580px. Covered.
- `.playlist-sidebar-info` — `position: sticky; top: 100px` (lines 413-423). Sticky is resolved against `.content-area`'s scrollport, not the viewport, so the mini-player padding is irrelevant to it. Not the shorts.vue pattern.
- `.playlist-detail-container { max-width: 1200px; margin: 0 auto }` (lines 372-376). Fluid.

**Checked, documented, NOT fixed (fits at 375px):** `.video-row` (lines 564-572) is a non-wrapping flex row whose hard floor is `.video-thumbnail-container` at `width: 120px; flex-shrink: 0` (lines 587-595), plus `.video-index` 24px, three 16px gaps, and the ~28px remove button — a hard minimum of ~215px, with `.video-info { flex: 1; min-width: 0 }` (lines 625-628) absorbing everything else. 215 < 240, so it fits at 375px; below ~340px `.video-info` collapses toward zero. Below the fix threshold — the width sweep records it, it is not changed.

#### 7. `app/components/VideoCard.vue` — **CLEAN, no issue found**

Read in full. Its entire `<style scoped>` block (lines 230-415) contains **no `vh` unit, no fixed pixel width on any layout box, and no media query — and needs none**: `.video-card` is `flex column`, `.thumbnail-wrapper` is `aspect-ratio: 16/9` (intrinsically width-driven), `.thumbnail-img` is `width: 100%; height: 100%`. The only fixed pixel dimensions in the file are `.channel-avatar` at `32px × 32px` with `flex-shrink: 0` (lines 365-372) — an avatar, sized far below any content box in the swept band — and small absolutely-positioned badges (`.duration-badge`, `.replay-badge`, `.preview-badge`) offset 8px from the thumbnail's own edges. `.channel-meta` carries `min-width: 0` (line 374-379) and `.video-title`/`.channel-title` are line-clamped/ellipsised, so long text cannot force the card wider than its grid cell. The card is fully width-fluid and inherits whatever track its parent grid gives it — which is exactly why fixing the parent grids (Bugs 2a and 3) is sufficient.

#### 8. `app/components/channels/ChannelVideoGrid.vue` — **no issue in this file; its one bug lives in `channels.vue`**

Read in full: the component has **no `<style>` block at all** (the file ends at line 247 with `</script>`). Every class it renders — `.channel-videos-section`, `.filter-sort-bar`, `.search-box`, `.filter-input`, `.filters-group`, `.filter-item`, `.filter-select`, `.video-grid`, `.shorts-grid`, `.admin-video-actions`, `.short-badge` — is styled by `channels.vue`'s unscoped block. Those were all audited under §2: the `.video-grid`/`.shorts-grid`/`.filters-group` rules are fine, and `.search-box` is Bug 2b, fixed in `channels.vue`. Nothing to change in this file.

#### 9. `app/components/channels/ChannelSettingsDrawer.vue` — **CLEAN; it does NOT need its own media query, and `channels.vue`'s 600px query does NOT cover it**

This is the specific question the spec asked (design spec line 9). Both halves answered, with evidence:

**Where the drawer's classes are defined:** neither in `ChannelSettingsDrawer.vue` (which, like `ChannelVideoGrid.vue`, has **no `<style>` block** — the file ends at line 185 with `</script>`), nor in `channels.vue`, but in the **global stylesheet** `app/assets/css/main.css:358-442` — `.drawer-backdrop` (359), `.drawer-backdrop.active` (371), `.settings-drawer` (376), `.settings-drawer.open` (395), `.drawer-header` (399), `.drawer-title` (407), `.drawer-close-btn` (414), `.drawer-body` (435). `channels.vue` contributes exactly **one** drawer rule, `.channels-page .drawer-body .spinner-sm` (line 533-541), which styles the save-button spinner only.

**Does `channels.vue`'s `@media (max-width: 600px)` cover the drawer?** **No.** That block (lines 335-341) has a single selector in it:

```css
@media (max-width: 600px) {
  .channels-page .channel-profile-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}
```

It touches only the surrounding page's profile header. It does not mention any drawer class, and it could not reach one anyway: `.settings-drawer` is `position: fixed` and is not a descendant of `.channel-profile-header`.

**Does the drawer need its own media query? No — it is already narrow-safe by construction.** `main.css:376-393`:

```css
.settings-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 450px;
  max-width: 100%;
  ...
  z-index: 999;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
}
```

- `max-width: 100%` already caps the 450px width at every viewport below 450px — this is the fix a media query would have added.
- `top: 0; bottom: 0` with `position: fixed` makes it a full-viewport panel like a modal, so it is correctly independent of `.content-area`'s mini-player padding — and its `z-index: 999` sits above both mini-player bars (`z-index: 900`, `MusicMiniPlayer.vue:238` / `PodcastMiniPlayer.vue:220`), so the bar cannot cover its controls.
- `position: fixed` is not trapped by a transformed ancestor: `.content-area` and `.channels-page` set no `transform`/`filter`/`backdrop-filter` (the only `transform` on the channels page is `.channel-card:hover`, which is not an ancestor of the drawer).
- `.drawer-body` is `flex: 1; overflow-y: auto; padding: 24px` (`main.css:435-442`), so tall content scrolls rather than clipping the delete button at the bottom.
- Contents are shrink-safe: the `.form-input`s are full-width, the submit/delete buttons are inline-styled `width: 100%`.

The one item the width sweep should *look* at rather than assume: the two-toggle row at `ChannelSettingsDrawer.vue:39` is `display: flex; gap: 24px` with no wrap; each `.toggle-switch` is a 44px slider (`main.css:459-466`) + 12px gap + label. At a 320px viewport the drawer is 320px wide and `.drawer-body`'s content box is 272px, versus a rough ~271px natural width for that row — within a pixel either way, and `.drawer-body`'s `overflow-y: auto` computes `overflow-x: auto` so the worst case is a scroll, not a clip. Recorded as a sweep observation, not a change.

### Audit summary

| # | File | Outcome |
|---|---|---|
| 1 | `app/pages/shorts.vue` | **BUG** — `.shorts-page-container` height ignores the 96px mini-player padding → Task 1 |
| 2a | `app/pages/channels.vue` | **BUG** — `.channel-grid` `minmax(295px, 1fr)` overflows below ~430px → Task 2 |
| 2b | `app/pages/channels.vue` | **BUG** — `.search-box` fixed `width: 260px` overflows below ~427px → Task 2 |
| 3 | `app/pages/subscriptions.vue` | **BUG** — `.video-grid` `minmax(280px, 1fr)` overflows below ~415px → Task 3 |
| 4 | `app/pages/index.vue` | Clean — no `vh` units at all; every grid has full breakpoint coverage; the one fixed width is inside a deliberate `overflow-x: auto` carousel; the full-bleed `calc(100% + 48px)` was verified to overflow by exactly 0px |
| 5 | `app/pages/playlists/index.vue` | Clean — no `vh` units at all; grid is 3→2→1 fr tracks with no minimum to overflow |
| 6 | `app/pages/playlists/[id].vue` | Clean in scope — its only `vh` is the out-of-scope `.modal-overlay` backdrop (confirmed, see discrepancies section); the 320px sidebar track collapses at 768px |
| 7 | `app/components/VideoCard.vue` | Clean — fully width-fluid, no `vh`, no fixed layout widths, `min-width: 0` where needed; correctly fixed by fixing its parent grids |
| 8 | `app/components/channels/ChannelVideoGrid.vue` | No `<style>` block; its styling lives in `channels.vue`, where Bug 2b is fixed |
| 9 | `app/components/channels/ChannelSettingsDrawer.vue` | Clean — no `<style>` block; classes are global (`main.css:358-442`); `channels.vue`'s 600px query does **not** cover it, but `max-width: 100%` + `position: fixed` + `overflow-y: auto` already make it narrow-safe. **No media query needed, none added.** |

**No pure, testable logic was surfaced by this audit** — all four bugs are declarative CSS values with no accompanying computed property, formatter, or state derivation. Per the Global Constraints, no automated tests are added; verification is Task 4's real-browser width sweep.

---

## File Structure

| File | Change |
|---|---|
| `app/pages/shorts.vue` | Modify — add the two player-composable imports + destructures, bind `has-mini-player` on the root, add the second height rule |
| `app/pages/channels.vue` | Modify — `.channel-grid` track minimum; `.search-box` + `.filter-input` shrink safety |
| `app/pages/subscriptions.vue` | Modify — `.video-grid` track minimum |
| `.claude/launch.json` | Create (only if absent) — dev-server config used by Task 4's browser sweep |

No new source files, no test files.

---

### Task 1: Make shorts.vue's height mini-player-aware

**Files:**
- Modify: `app/pages/shorts.vue:2` (template root), `app/pages/shorts.vue:166-186` (script setup), `app/pages/shorts.vue:546-553` (style)
- Test: none (established convention — no automated tests for these pages; see Global Constraints)

**Interfaces:**
- Consumes: `useMusicPlayer()` from `~/composables/useMusicPlayer` — returns an object including `currentTrack: Ref<PlayableTrack | null>`. `usePodcastPlayer()` from `~/composables/usePodcastPlayer` — returns an object including `currentEpisode: Ref<PlayableEpisode | null>`. Both are `useState`-backed, so they are the same shared refs `app/layouts/default.vue` reads; no new state is created. CSS var `--header-height` (56px, `app/assets/css/main.css:43`).
- Produces: a `.has-mini-player` class on `.shorts-page-container` — the same class name `default.vue` uses on `.content-area`, but scoped to `shorts.vue`'s own stylesheet, so the two do not interfere. Task 4 asserts against this class name and against the `.shorts-page-container` / `.reel-item.is-active .progress-bar-thin` selectors.

- [ ] **Step 1: Bind the mini-player class on the page root**

In `app/pages/shorts.vue`, replace line 2:

```vue
  <div class="shorts-page-container">
```

with:

```vue
  <div class="shorts-page-container" :class="{ 'has-mini-player': !!currentTrack || !!currentEpisode }">
```

- [ ] **Step 2: Import and destructure the two player composables**

In `app/pages/shorts.vue`, replace lines 167-168:

```ts
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue';
import { useToast } from '~/composables/useToast';
```

with:

```ts
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue';
import { useToast } from '~/composables/useToast';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
```

Then replace line 186:

```ts
const toast = useToast();
```

with:

```ts
const toast = useToast();
// Mirrors app/layouts/default.vue:105 + 142-143 — same shared useState refs,
// so this page's height and the layout's padding can never disagree.
const { currentTrack } = useMusicPlayer();
const { currentEpisode } = usePodcastPlayer();
```

- [ ] **Step 3: Subtract the matching padding pair in CSS**

In `app/pages/shorts.vue`, replace lines 546-553:

```css
.shorts-page-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: calc(100vh - var(--header-height) - 48px);
  padding: 0;
  overflow: hidden;
}
```

with:

```css
.shorts-page-container {
  display: flex;
  justify-content: center;
  align-items: center;
  /* .content-area is the viewport minus the header; its own padding is 24px on
     every side (app/layouts/default.vue:640-648), so the usable height is
     100vh - header - 24 - 24. When a mini-player bar is on screen the layout
     raises padding-bottom to 96px (72px bar + 24px gap,
     app/layouts/default.vue:650-652), so the pair becomes 24 + 96 = 120.
     Without the second rule the feed renders 72px too tall and the active
     short's bottom info + seek bar hide behind the bar. */
  height: calc(100vh - var(--header-height) - 48px);
  padding: 0;
  overflow: hidden;
}

.shorts-page-container.has-mini-player {
  height: calc(100vh - var(--header-height) - 120px);
}
```

- [ ] **Step 4: Confirm the app still builds and the existing suite is unaffected**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS — the existing Vitest suite is unrelated to these pages and must stay green (no new tests are added by this task).

- [ ] **Step 5: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/pages/shorts.vue
git commit -m "fix: make shorts feed height account for the mini-player bar

.shorts-page-container subtracted a hard-coded 48px for .content-area's
padding, which is only correct when no mini-player is active. With a bar on
screen the layout reserves 96px at the bottom, so the feed rendered 72px too
tall and the active short's info overlay and seek bar were hidden behind the
bar. Mirrors default.vue's !!currentTrack || !!currentEpisode check.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix channels.vue's two narrow-viewport overflows

**Files:**
- Modify: `app/pages/channels.vue:137-141` (`.channel-grid`), `app/pages/channels.vue:564-574` (`.search-box`), `app/pages/channels.vue:580-586` (`.filter-input`)
- Test: none (established convention)

**Interfaces:**
- Consumes: nothing from Task 1. `channels.vue`'s `<style>` is **unscoped** (line 113), which is what lets it style `ChannelDirectoryView.vue`'s `.channel-grid` (rendered at `ChannelDirectoryView.vue:7, 28`) and `ChannelVideoGrid.vue`'s `.search-box`/`.filter-input` (rendered at `ChannelVideoGrid.vue:5, 7-12`). Do not add `scoped` to this block — it would silently unstyle both components.
- Produces: `.channels-page .channel-grid` and `.channels-page .search-box` stop overflowing their container below ~430px. Task 4 measures `.content-area`'s `scrollWidth - clientWidth` on `/channels` to assert this.

- [ ] **Step 1: Cap the channel-grid track minimum at the container width**

In `app/pages/channels.vue`, replace lines 137-141:

```css
.channels-page .channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(295px, 1fr));
  gap: 24px;
}
```

with:

```css
.channels-page .channel-grid {
  display: grid;
  /* min(295px, 100%) instead of a bare 295px: minmax()'s minimum is a hard
     floor, so on a content box narrower than 295px (any viewport under ~430px)
     the single column was wider than its container and pushed a horizontal
     scrollbar onto .content-area. No-op at every width where 295px fits. */
  grid-template-columns: repeat(auto-fill, minmax(min(295px, 100%), 1fr));
  gap: 24px;
}
```

- [ ] **Step 2: Make the filter search box shrinkable and width-capped**

In `app/pages/channels.vue`, replace lines 564-574:

```css
.channels-page .search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 12px;
  border-radius: 40px;
  height: 36px;
  width: 260px;
}
```

with:

```css
.channels-page .search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 12px;
  border-radius: 40px;
  height: 36px;
  width: 260px;
  /* 260px + .filter-sort-bar's 32px padding needs a 292px content box, which a
     viewport under ~427px does not have. max-width caps it; min-width: 0
     defeats the flex item's automatic minimum size, which was otherwise
     floored by the text input's intrinsic width and blocked the shrink. */
  max-width: 100%;
  min-width: 0;
}
```

- [ ] **Step 3: Let the input inside it shrink too**

In `app/pages/channels.vue`, replace lines 580-586:

```css
.channels-page .filter-input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  width: 100%;
}
```

with:

```css
.channels-page .filter-input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  width: 100%;
  /* Without this, the input's intrinsic size sets .search-box's min-content
     width and the max-width above can never actually take effect. */
  min-width: 0;
}
```

- [ ] **Step 4: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/pages/channels.vue
git commit -m "fix: stop channels page overflowing at mobile widths

.channel-grid's minmax(295px, 1fr) and the 260px .search-box both exceeded the
content box below a ~430px viewport, producing a horizontal scrollbar on the
channels directory and the channel-detail filter bar. Caps both at the
container width; no-ops wherever the original sizes fit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Fix subscriptions.vue's narrow-viewport grid overflow

**Files:**
- Modify: `app/pages/subscriptions.vue:296-300` (`.video-grid`)
- Test: none (established convention)

**Interfaces:**
- Consumes: nothing from Tasks 1-2. `.video-grid` here is `<style scoped>` and applies to the page's own `<div class="video-grid">` elements (`subscriptions.vue:27` loading skeleton and `:51` results grid), not to `<VideoCard>`'s internals — `VideoCard.vue` is fully width-fluid and needs no change (audit §7).
- Produces: `/subscriptions` stops overflowing below ~415px. Task 4 measures `.content-area`'s `scrollWidth - clientWidth` on that route.

- [ ] **Step 1: Cap the video-grid track minimum at the container width**

In `app/pages/subscriptions.vue`, replace lines 296-300:

```css
.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}
```

with:

```css
.video-grid {
  display: grid;
  /* Same fix as .channels-page .channel-grid: minmax()'s 280px minimum is a
     hard floor, so any content box under 280px (viewport under ~415px) made
     the single column wider than its container. This page has no media
     queries at all, so nothing else covered it. */
  grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
  gap: 24px;
}
```

- [ ] **Step 2: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/pages/subscriptions.vue
git commit -m "fix: stop subscriptions grid overflowing at mobile widths

repeat(auto-fill, minmax(280px, 1fr)) never shrinks below 280px, so on a
viewport under ~415px the single column was wider than the content box. This
page has no media queries, so nothing else covered it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Manual end-to-end verification — real-browser width sweep

This is the task the Global Constraints mandate: measured rendered layout, not a CSS read. Sub-project 1 needed three rounds before a genuine width sweep caught what CSS-reading missed, so nothing below is optional.

**Files:**
- Create (only if it does not already exist): `.claude/launch.json`
- Modify: none
- Test: none automated — this task is the verification

**Interfaces:**
- Consumes: `.shorts-page-container`, `.shorts-page-container.has-mini-player`, `.reel-item.is-active`, `.reel-bottom-info`, `.progress-bar-thin` (Task 1); `.channels-page .channel-grid`, `.channels-page .search-box` (Task 2); `.video-grid` on `/subscriptions` (Task 3); `.content-area` and `.mini-player` / `.podcast-mini-player` from the layout.
- Produces: a pass/fail record for every swept width and route, plus a `git diff --stat` proving the five clean files were left untouched. Nothing downstream consumes it — this is the final task.

- [ ] **Step 1: Ensure a dev-server launch config exists**

Check for `/Users/light/Git/youkeep/.claude/launch.json`. If it is absent, create it with exactly:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "youkeep-dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 3000
    }
  ]
}
```

If the file already exists, leave it alone and use whatever configuration name it defines in the following steps.

- [ ] **Step 2: Start the dev server and open the browser pane**

Start the `youkeep-dev` configuration via the browser-preview tool (`preview_start` with `name: "youkeep-dev"`), then log in as an admin user (admin is needed for `/channels`'s `ChannelSettingsDrawer` and `ChannelVideoGrid`'s admin overlay controls).

Expected: the app renders at `http://localhost:3000`.

- [ ] **Step 3: Sweep the four fixed/affected routes for horizontal overflow, with NO mini-player active**

For each route in `/`, `/channels`, `/channels?id=<any archived channel id>`, `/subscriptions`, `/playlists`, `/playlists/<any playlist id>`, `/shorts` — and at each width in **1440, 1280, 1024, 900, 768, 640, 480, 375, 320** (set with `resize_window`, reloading after each resize so load-time gates re-run) — run:

```js
(() => {
  const ca = document.querySelector('.content-area');
  if (!ca) return { error: 'no .content-area' };
  return {
    route: location.pathname + location.search,
    width: window.innerWidth,
    clientWidth: ca.clientWidth,
    scrollWidth: ca.scrollWidth,
    overflowPx: ca.scrollWidth - ca.clientWidth,
    docOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
})()
```

Expected: `overflowPx <= 0` and `docOverflowPx <= 0` at **every** width on **every** route. Before Tasks 2-3 this returns roughly `+55` on `/channels` at 375px, `+52` on `/channels?id=…`, and `+40` on `/subscriptions`; after them all three must read `0`.

Record any non-zero result with its route and width — that is a failure, not a note.

- [ ] **Step 4: Verify the shorts fix WITHOUT an active mini-player**

Navigate to `/shorts` with no music or podcast playing (clear it first if needed by running `localStorage.removeItem('music_player_state'); localStorage.removeItem('podcast_player_state');` and reloading). At each width in **1440, 1024, 900, 768, 640, 480, 375, 320**, wait for the first reel to become active, then run:

```js
(() => {
  const c = document.querySelector('.shorts-page-container');
  const bar = document.querySelector('.mini-player, .podcast-mini-player');
  const active = document.querySelector('.reel-item.is-active');
  const prog = active && active.querySelector('.progress-bar-thin');
  const info = active && active.querySelector('.reel-bottom-info');
  const r = el => (el ? el.getBoundingClientRect() : null);
  return {
    width: window.innerWidth,
    hasMiniPlayerClass: c.classList.contains('has-mini-player'),
    barPresent: !!bar,
    containerBottom: r(c).bottom,
    viewportHeight: window.innerHeight,
    progressBottom: r(prog) && r(prog).bottom,
    infoBottom: r(info) && r(info).bottom
  };
})()
```

Expected at every width: `hasMiniPlayerClass === false`, `barPresent === false`, and `containerBottom <= viewportHeight` (the feed ends inside the viewport). `progressBottom` and `infoBottom` must both be finite numbers `<= viewportHeight`.

- [ ] **Step 5: Verify the shorts fix WITH an active mini-player**

Navigate to `/music`, play any track (this calls `useMusicPlayer().play()`, which sets `currentTrack` and activates the music bar), then navigate to `/shorts` **without reloading** so the player state survives. At each width in **1440, 1024, 900, 768, 640, 480, 375, 320**, run the same snippet as Step 4.

Expected at every width:
- `hasMiniPlayerClass === true` and `barPresent === true` — the class binding actually reacts to `currentTrack`.
- `containerBottom <= (window.innerHeight - 72)` — the feed ends at or above the 72px bar.
- `progressBottom` and `infoBottom` are finite and `<= (window.innerHeight - 72)` — the seek bar and the info overlay are both fully above the bar, which is the exact regression this sub-project exists to fix.

Then repeat the whole step once with a **podcast** instead: navigate to `/podcasts`, play any episode (sets `currentEpisode`), return to `/shorts`, re-run at 1440 / 768 / 375. Expected: identical results — this proves the `|| !!currentEpisode` half of the binding, not just the music half.

- [ ] **Step 6: Hit-test that the shorts controls are actually clickable, not merely on-screen**

Still on `/shorts` with a mini-player active, at 1024px and again at 375px, run:

```js
(() => {
  const prog = document.querySelector('.reel-item.is-active .progress-bar-thin');
  const title = document.querySelector('.reel-item.is-active .channel-title');
  const hit = el => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return t ? (t.className && t.className.toString()) || t.tagName : null;
  };
  return { width: window.innerWidth, progressHit: hit(prog), channelTitleHit: hit(title) };
})()
```

Expected: `progressHit` contains `progress` (the seek bar itself, or its `progress-fill` child — not `mini-player`), and `channelTitleHit` contains `channel-title`. Anything reporting a mini-player class means the bar is still on top of the control and Task 1 is not actually fixed.

- [ ] **Step 7: Spot-check the two documented, deliberately-unfixed items**

At 320px only, on `/channels?id=<id>` run:

```js
(() => {
  const g = document.querySelector('.summary-grid-layout');
  const rows = Array.from(document.querySelectorAll('.video-row'));
  return {
    summaryOverflowPx: g ? g.scrollWidth - g.clientWidth : 'absent',
    worstVideoRowOverflowPx: rows.length
      ? Math.max(...rows.map(r => r.scrollWidth - r.clientWidth))
      : 'absent'
  };
})()
```

and the same `worstVideoRowOverflowPx` half on `/playlists/<id>`. These are **observations, not gates** — the audit recorded both as fitting at 375px and degrading only below ~335-340px, and the Global Constraints forbid speculative work. Write the measured numbers into the verification record so a future sub-project has real data instead of a guess. If either turns out to overflow at **375px** (contradicting the audit's arithmetic), stop and report it rather than fixing it silently.

- [ ] **Step 8: Confirm every clean file was left untouched**

Run: `cd /Users/light/Git/youkeep && git diff --stat main -- app/ .claude/`

Expected: exactly three `app/` files listed — `app/pages/shorts.vue`, `app/pages/channels.vue`, `app/pages/subscriptions.vue` (plus `.claude/launch.json` if Step 1 created it). **Zero** changes to `app/pages/index.vue`, `app/pages/playlists/index.vue`, `app/pages/playlists/[id].vue`, `app/components/VideoCard.vue`, `app/components/channels/ChannelVideoGrid.vue`, `app/components/channels/ChannelSettingsDrawer.vue`, `app/layouts/default.vue`, `app/composables/useMusicPlayer.ts`, `app/composables/usePodcastPlayer.ts`, or `app/assets/css/main.css`.

Any file in that second list appearing in the diff means work was done outside the audit's findings — revert it.

- [ ] **Step 9: Stop the dev server and commit the launch config if it was created**

Stop the preview server. Then:

```bash
cd /Users/light/Git/youkeep
git status --short .claude/
```

If `.claude/launch.json` is newly untracked and the repo tracks `.claude/` (check `git check-ignore .claude/launch.json` — no output means it is not ignored):

```bash
cd /Users/light/Git/youkeep
git add .claude/launch.json
git commit -m "chore: add dev-server launch config for browser verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

If it is ignored, skip the commit.

---

## Self-Review

Run at the end of writing, against the design spec at `docs/superpowers/specs/2026-09-05-catalog-pages-responsive-audit-design.md`. Issues found were fixed inline before saving; the record is kept here deliberately.

### 1. Spec coverage

| Spec requirement | Where it lands | Outcome |
|---|---|---|
| Goal 1 — fix `shorts.vue`'s mini-player-blind height | Task 1 | Covered, with exact code mirroring `default.vue:105, 142-143` |
| Goal 2 — audit `index.vue` | Audit §4 | **Checked, no issue found.** Zero `vh` units; grids 4→3→2→1; the one fixed width is inside a deliberate `overflow-x: auto` carousel; the `calc(100% + 48px)` bleed verified to overflow by exactly 0px |
| Goal 2 — audit `channels.vue` | Audit §2 | **Two real bugs found** (`.channel-grid` minmax, `.search-box` width) → Task 2 |
| Goal 2 — audit `subscriptions.vue` | Audit §3 | **One real bug found** (`.video-grid` minmax) → Task 3 |
| Goal 2 — audit `playlists/index.vue` | Audit §5 | **Checked, no issue found.** Zero `vh` units; 3→2→1 fractional tracks with no minimum |
| Goal 2 — audit `playlists/[id].vue` | Audit §6 + discrepancies section | **Checked, no in-scope issue.** Its only `vh` is the out-of-scope `.modal-overlay`; sidebar track collapses at 768px |
| Goal 2 — audit `VideoCard.vue` | Audit §7 | **Checked, no issue found.** No `vh`, no fixed layout widths, `min-width: 0` present; fixed by fixing its parent grids |
| Goal 2 — audit `ChannelVideoGrid.vue` | Audit §8 | **Checked.** No `<style>` block; its one bug is `.search-box`, fixed in `channels.vue` (Task 2) |
| Goal 3 — settle whether `ChannelSettingsDrawer.vue` needs its own media query | Audit §9 | **Answered both halves.** Classes are global (`main.css:358-442`), not in the component and not in `channels.vue` (which contributes only `.drawer-body .spinner-sm`). `channels.vue`'s 600px query covers **only** `.channel-profile-header` and cannot reach a `position: fixed` non-descendant. **No media query needed** — `max-width: 100%` + `position: fixed` + `overflow-y: auto` already handle it. Nothing added. |
| Verification — real measurement at swept widths, shorts with *and* without a bar | Task 4 Steps 3-6 | Covered; Step 5 exercises both the music and podcast halves of the binding, Step 6 hit-tests clickability |
| Verification — confirm clean pages left unmodified | Task 4 Step 8 | Covered by `git diff --stat` with an explicit must-be-absent file list |
| Testing — no automated tests unless pure logic surfaces | Audit summary + every task's Test line | Covered. No pure logic surfaced — all four bugs are declarative CSS values. No test files added. |

No gap found. Every spec section maps to a task or to a recorded audit outcome.

**A note the skill's instructions specifically invited:** the audit did *not* come back with "shorts.vue only." It found three additional real overflow bugs, all of the same shape and all breaking at 375px — a mainstream mobile width well inside the band sub-project 1 already supports. They are fixed with exact code (Tasks 2-3), not described. Conversely, the audit deliberately did **not** invent work for `index.vue`, `playlists/index.vue`, `playlists/[id].vue`, `VideoCard.vue`, `ChannelVideoGrid.vue`, or `ChannelSettingsDrawer.vue`, and Task 4 Step 8 makes leaving them untouched a verified outcome rather than an assumption. Two marginal items (`.summary-grid-layout`, `.video-row`) were found, measured, judged below the 375px fix threshold, and recorded as sweep observations rather than converted into speculative fixes.

### 2. Placeholder scan

Searched the plan for the forbidden patterns: `TBD`, `TODO`, `implement later`, `fill in details`, `add appropriate error handling`, `add validation`, `handle edge cases`, `write tests for the above`, `similar to Task N`, and any step that describes a change without showing it.

- **One issue found and fixed inline:** an early draft of the audit section carried the heading "Audit each catalog page and fix what you find," which is precisely the placeholder pattern the skill forbids. Replaced with the completed per-file findings in Audit §1-§9, each naming exact line numbers and either a bug with its fix or an explicit "checked, no issue found, here's what was checked."
- Every CSS step in Tasks 1-3 shows the **full before and after block**, not a fragment or a description.
- Every browser step in Task 4 shows the **complete JS snippet** to run and the **exact numeric pass condition**, not "check that it looks right."
- Task 4 Step 1's `launch.json` is given in full rather than referenced.
- No step says "similar to Task N" — Task 3 restates its full rule even though it is the same idiom as Task 2 Step 1.

### 3. Type and signature consistency

- `currentTrack` / `currentEpisode`: read from the composables' current on-disk return statements (`useMusicPlayer.ts:292-297`, `usePodcastPlayer.ts:251-255`), not from the spec's prose. Task 1 Step 2's destructure matches `default.vue:142-143` character for character, and Task 1 Step 1's binding expression matches `default.vue:105` character for character. Both are `useState`-backed, so `shorts.vue` reads the same refs the layout does — the class and the padding cannot drift.
- Class name `has-mini-player` is used identically in Task 1 Steps 1 and 3 and asserted under that exact name in Task 4 Steps 4-5.
- `96px` / `120px` arithmetic: `.content-area`'s padding is `24px` all round with `padding-bottom: 96px` when active, so the pairs are `24 + 24 = 48` and `24 + 96 = 120`. Both mini-player bars are `72px` at every breakpoint (verified in all three tiers of both components), so `96 = 72 + 24` holds at every width — Task 4 Step 5's `window.innerHeight - 72` gate is therefore valid at 375px and 320px too, not just at desktop.
- Selectors used in Task 4's snippets were each confirmed to exist in the current templates: `.shorts-page-container` (`shorts.vue:2`), `.reel-item` + `.is-active` (`shorts.vue:27-28`), `.reel-bottom-info` (`:81`), `.progress-bar-thin` (`:97`), `.channel-title` (`:83`), `.content-area` (`default.vue:105`), `.mini-player` (`MusicMiniPlayer.vue:225`), `.podcast-mini-player` (`PodcastMiniPlayer.vue:207`), `.channel-grid` (`ChannelDirectoryView.vue:7, 28`), `.search-box` (`ChannelVideoGrid.vue:5`), `.summary-grid-layout` (`ChannelStatsPanel.vue:53`), `.video-row` (`playlists/[id].vue:85`).
- Test command is `npm test` → `vitest run`, taken from `package.json:11`.
- Task 2's Interfaces block explicitly warns not to add `scoped` to `channels.vue`'s `<style>` — the single change that would silently break `ChannelDirectoryView`, `ChannelStatsPanel` and `ChannelVideoGrid` at once.
