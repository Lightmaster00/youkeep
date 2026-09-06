# Music/Podcasts Catalog Responsive Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six confirmed narrow-viewport overflow bugs found by a real-browser audit of `app/pages/music/index.vue` and `app/pages/podcasts/index.vue` (grid view, filters bar, detail header, and track/episode rows on each page), then verify every fix by real-browser width-sweep measurement.

**Architecture:** Both pages share an almost identical structure (a filter/search grid view and an inline detail view with a cover+info header and a row-based list), and every bug found is the same underlying shape already seen in this codebase's prior responsive fixes: a hard pixel floor (a `minmax()` grid track minimum, a `min-width` on a flex item, or several `flex-shrink: 0` siblings competing for space) that exceeds the content box available at a narrow viewport. All six fixes reuse idioms already established and merged in this app: `minmax(min(<px>, 100%), 1fr)` for grid tracks, dropping/zeroing a `min-width` floor on a flex item, `overflow-x: auto` on a row that cannot otherwise fit its fixed-size children, and the exact `flex-direction: column` header-stacking media query already shipped for `channels.vue`'s `.channel-profile-header`.

**Tech Stack:** Nuxt 4 (Vue 3 `<script setup>`, SFC scoped `<style>`), Nitro, better-sqlite3, Vitest 4 + happy-dom + `@vue/test-utils` (`npm test` → `vitest run`).

## Global Constraints

- No changes to `app/components/BaseModal.vue`.
- No changes to Settings pages (`SettingsMusicTab.vue`/`SettingsPodcastsTab.vue`) — separate, unscoped area of the responsive initiative.
- No card-based mobile layout redesign for track/episode rows — overflow fixes only, not layout philosophy changes.
- No new automated tests for this bug class — CSS overflow has no automated coverage anywhere in this codebase; verification is real-browser measurement only.
- Fixes reuse the already-established idioms verbatim: `minmax(min(<px>px, 100%), 1fr)` for grid tracks; removing/capping a `min-width` floor on a flex item that cannot otherwise shrink to fit; `overflow-x: auto` on an unwrappable row of fixed-size children; the `flex-direction: column` stacking media query already used by `channels.vue`'s `.channel-profile-header`. Do not invent a new pattern for a bug shape this codebase has already solved.
- Every claimed fix is backed by real-browser before/after `scrollWidth - clientWidth` measurement at 320/375/414/480/600/900px minimum — not CSS-reading-only verification.

---

## Audit Results

This section is the completed investigation, done directly against the running app (dev server + real browser, logged in via the `POST /api/dev/login` fixture, `ALLOW_DEV_LOGIN=1` in a local, gitignored `.env`), using real archived content: the artist **GIMS** (28 standalone tracks, no albums, one track's admin-only "Télécharger le clip" button in play) and the podcast **Planet Money** (356 episodes, `NPR` as author, a bio containing an unbroken email address). Every candidate the design spec flagged was measured, not assumed — one candidate (the grid track minimum) turned out to need a smaller fix than expected, and two real bugs were found that the spec's candidate list only gestured at (the detail header, and the track/episode row shape) but did not pin down.

### Layout facts measured against

| Fact | Value |
|---|---|
| `.content-area` clientWidth at 320px viewport | 240px |
| `.content-area` clientWidth at 375px viewport | not directly measured, but zero overflow at 375px is the pass bar used throughout |
| `.music-filters-bar` / `.podcast-filters-bar` clientWidth at 320px viewport | 192px (240 minus the page's own no extra padding — filters bar is a direct flex child of the page root) |

### Per-element findings

#### 1. `.artist-grid` (music/index.vue:657-661) / `.show-grid` (podcasts/index.vue:366-370) — **BUG CONFIRMED, smaller than the design spec suspected**

```css
.artist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}
```

Measured on `/music` (identical numbers independently confirmed on `/podcasts`):

| Viewport | `.content-area` overflow | `.artist-grid` overflow |
|---|---|---|
| 320px | 4px | 28px |
| 340px | 0px | 8px |
| 375px | 0px | 0px |

The design spec's candidate note guessed this might already be safe at 320px because 220px is smaller than the previously-fixed 260-295px values — that guess was wrong in the other direction: it is NOT safe at 320px, but it IS safe at 375px and every wider width. This is a real, if narrow, bug: some real Android devices report a 320-360px viewport width. The fix is the same free, no-op-above-threshold idiom used three times already in this initiative — worth applying even though it's a smaller-radius bug than the channels/subscriptions grids were.

#### 2. `.music-search-input` (music/index.vue:590-593) / `.podcast-search-input` (podcasts/index.vue:354-357) — **BUG CONFIRMED**

```css
.music-search-input {
  flex: 1;
  min-width: 200px;
}
```

| Viewport | `.music-filters-bar` overflow |
|---|---|
| 320px | 8px |
| 340px | 0px |
| 375px | 0px |

Even though the input sits alone on its own wrapped line at narrow widths (`.music-filters-bar` has `flex-wrap: wrap`), the explicit `min-width: 200px` is a hard floor that the wrap cannot route around: at 320px the filters bar's own content box is 192px, 8px short of the 200px floor. The three `<select>` elements' `min-width: 150px` never overflow in the swept range (150 < 192, confirmed by measuring each select's rendered width at 320px: 162.5/181.5/178px, none clipped) — only the search input's floor is a bug.

#### 3. `.artist-detail-header` (music/index.vue:706-711) / `.show-detail-header` (podcasts/index.vue:415-420) — **BUG CONFIRMED — the design spec's "low suspicion" candidate is the largest bug found**

```css
.artist-detail-header {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 32px;
}
```

| Page | Viewport | `.content-area` overflow | header overflow |
|---|---|---|---|
| music (GIMS) | 320px | 79px | 103px |
| music (GIMS) | 375px | 24px | 48px |
| music (GIMS) | 480px | 0px | 0px |
| podcasts (Planet Money) | 320px | 39px | 63px |
| podcasts (Planet Money) | 375px | 0px | 8px |
| podcasts (Planet Money) | 480px | not measured (already 0 at 375) | — |

Root cause, traced by disabling and re-adding CSS rules live: the 96px avatar (music) / 140px cover (podcasts), both `flex-shrink: 0`, leave very little width for the info column once the viewport is narrow (`.artist-detail-info`'s rendered width was measured at 76px at 320px on the music page). Within that sliver, several different pieces of real content each independently exceed it — a bio containing an unbroken email address (`pro.gims86@gmail.com`, on the music page), the "Lecture aléatoire" button's icon+label (which as a flex-nowrap inline-flex button cannot wrap internally), and the podcast title/visibility badge pairing. No single word-break or min-width tweak on one child fixes all of these at once, because the *column itself* is simply too narrow at this range for a side-by-side layout to hold anything.

**The fix that actually works, verified live:** stack the header vertically below 480px, exactly mirroring the media query `channels.vue` already ships for its own avatar+info header:

```css
/* app/pages/channels.vue:335-341, already merged and in production */
@media (max-width: 600px) {
  .channels-page .channel-profile-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}
```

Applying the equivalent `flex-direction: column; align-items: center; text-align: center;` at `max-width: 480px` to `.artist-detail-header` and to `.show-detail-header` independently brought BOTH pages' overflow to exactly 0px at every swept width, with no other CSS change needed — confirmed by re-testing with the word-break/button-wrap approach first (it required three separate, content-shape-specific hacks and still needed verification per content type) and then finding the single stacking rule supersedes all of them. 480px (not 600px, which is what `channels.vue` uses) is the right breakpoint here because these two headers' avatar/cover (96px/140px) plus gap (20px) already consume so much of a 480-600px content box that a side-by-side layout is cramped even where it technically doesn't overflow — matches the width where the un-stacked layout was independently measured to stop overflowing (480px was the first clean width found on both pages).

#### 4. `.track-row` / `.track-title` (music/index.vue:781-789, 815-817) — **BUG CONFIRMED, and clipped invisibly rather than scrolling**

```css
.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  cursor: pointer;
}
/* ... */
.track-title {
  flex: 1;
}
```

| Viewport | Worst-case row internal overflow (28 rows measured) |
|---|---|
| 320px | 232px |
| 375px | 177px |
| 480px | 72px |
| 600px | 0px |

`.track-title` has no `min-width: 0`, but that alone is not the dominant cause: `.track-number` (24px), `.track-duration`, `.edit-btn`, and — for an admin viewing a track with no downloaded clip yet — the `.clip-download-btn` ("Télécharger le clip", measured at 128px) are all `flex-shrink: 0`. At 320-480px their combined width alone exceeds the row's content box even before `.track-title` is considered, so no amount of title-shrinking closes the gap on rows where the clip-download button is showing. **This is worse than a page-level scrollbar**: `.album-group` (the wrapping card) has `overflow: hidden` (music/index.vue:735-740), so the excess content is silently clipped and the trailing controls (duration, edit button, clip-download button) become invisible and unreachable, with no visual indication anything is missing.

**Fix, verified live:** give `.track-title` a genuine ability to shrink and truncate, and make the row itself individually horizontally scrollable so the clipped controls are still reachable rather than silently lost:

```css
.track-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-row {
  overflow-x: auto;
}
```

Confirmed live: `.content-area`'s overflow drops to 0px at 320px with this pair of rules, and the previously-clipped `.clip-download-btn` becomes reachable by scrolling the row itself (`row.scrollLeft = 9999` moved it to `139.5`, i.e. the row actually scrolls). `white-space: nowrap` + `text-overflow: ellipsis` truncates long titles to one line instead of the current multi-line wrap — this is the same ellipsis-truncation idiom already used elsewhere in this codebase (e.g. `channels.vue`'s `.channel-card-title`), not a new pattern, and it is what makes the `overflow: hidden` on `text-overflow` actually readable rather than just clipping mid-character.

#### 5. `.episode-row` (podcasts/index.vue:454-461) — **BUG CONFIRMED, smaller than the music-page equivalent**

```css
.episode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
}
```

`.episode-main` already has `min-width: 0` (podcasts/index.vue:467-470) — unlike the music page's `.track-title`, this page's design spec candidate note was right that this part was already correct. But `.episode-play-btn` (26px), the status `.badge` ("Téléchargé", measured at 96.7px), and `.edit-btn` (22px) are all effectively fixed-size and, combined, still exceed the row's content box at the narrowest width:

| Viewport | Worst-case row internal overflow |
|---|---|
| 320px | 23px |
| 375px | 0px |

Smaller magnitude than the music page (no equivalent of the wide `.clip-download-btn`, since there's no per-episode "download" action once already completed), but the same underlying shape and the same silent-clipping risk (`.episode-list` has `border-radius` and `overflow: hidden` — need to confirm exact property on the actual container during the fix task, since the exact clip mechanism should be re-checked against the live file rather than assumed identical to the music page).

**Fix, verified live:** `.episode-row { overflow-x: auto; }` alone (no title change needed, `.episode-main` is already correctly configured) brings `.content-area`'s overflow to 0px at 320px, with the row's content reachable by scroll rather than clipped.

#### 6. The 3 edit modals — **2 of 3 verified clean live; the 3rd is structurally identical to the other two**

- `PodcastEpisodeEditModal.vue`: opened live at 320px on a real episode. `.modal-card` overflow: 0px. Clean.
- `MusicTrackEditModal.vue`: opened live at 320px on a real track. `.modal-card` overflow: 0px. Clean.
- `MusicAlbumEditModal.vue`: **could not be opened with the available test data** — the only archived artist (GIMS) has zero albums (all 28 tracks are "Titres sans album"), so its edit-album button never renders. Not directly measured. However, its template (read in full) uses only the same `BaseModal` shell, the same global `form-input`/`form-group` classes, and the same `margin-top: 16px` inline spacing pattern as the two verified-clean modals, with no fixed widths of its own — structurally identical to what was just confirmed clean twice. No fix is planned for it; the final verification task documents this gap explicitly rather than silently skipping it.

### Audit summary

| # | Element | File | Outcome |
|---|---|---|---|
| 1 | `.artist-grid` | `music/index.vue:657-661` | **BUG** — overflows below ~350px → Task 1 |
| 1 | `.show-grid` | `podcasts/index.vue:366-370` | **BUG** — identical shape → Task 2 |
| 2 | `.music-search-input` | `music/index.vue:590-593` | **BUG** — overflows below ~340px → Task 1 |
| 2 | `.podcast-search-input` | `podcasts/index.vue:354-357` | **BUG** — identical shape → Task 2 |
| 3 | `.artist-detail-header` | `music/index.vue:706-711` | **BUG** — overflows below 480px, largest found → Task 1 |
| 3 | `.show-detail-header` | `podcasts/index.vue:415-420` | **BUG** — same shape → Task 2 |
| 4 | `.track-row` / `.track-title` | `music/index.vue:781-789, 815-817` | **BUG** — silently clips controls below 600px → Task 1 |
| 5 | `.episode-row` | `podcasts/index.vue:454-461` | **BUG** — same shape, smaller magnitude → Task 2 |
| 6 | 3 edit modals | components | 2 of 3 clean (verified live); 3rd structurally identical, undeterminable with current data → Task 3 documents this |

No pure, testable logic was surfaced — every bug is a declarative CSS value. Per the Global Constraints, no automated tests are added; verification is Task 3's real-browser width sweep plus each fix task's own re-measurement.

---

## File Structure

| File | Change |
|---|---|
| `app/pages/music/index.vue` | Modify — `.artist-grid`, `.music-search-input`, `.artist-detail-header` (+ new media query), `.track-title`, `.track-row` |
| `app/pages/podcasts/index.vue` | Modify — `.show-grid`, `.podcast-search-input`, `.show-detail-header` (+ new media query), `.episode-row` |

No new source files, no test files, no changes to any modal or `BaseModal.vue`.

---

### Task 1: Fix music/index.vue's five narrow-viewport overflows

**Files:**
- Modify: `app/pages/music/index.vue:590-593` (`.music-search-input`), `:657-661` (`.artist-grid`), `:706-711` (`.artist-detail-header`), `:781-789` (`.track-row`), `:815-817` (`.track-title`)
- Test: none (established convention — no automated tests for this bug class)

**Interfaces:**
- Consumes: nothing from other tasks. All changes are self-contained CSS inside `music/index.vue`'s own `<style scoped>` block.
- Produces: `/music`'s grid view and detail view stop overflowing their container at every width from 320px up. Task 3 re-measures `.content-area`'s `scrollWidth - clientWidth` on this route to assert this.

- [ ] **Step 1: Cap the artist-grid track minimum at the container width**

In `app/pages/music/index.vue`, replace lines 657-661:

```css
.artist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}
```

with:

```css
.artist-grid {
  display: grid;
  /* min(220px, 100%) instead of a bare 220px: minmax()'s minimum is a hard
     floor, so on a content box narrower than 220px (any viewport under
     ~350px) the single column was wider than its container. No-op at every
     width where 220px fits (measured clean at 375px and up). */
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 20px;
}
```

- [ ] **Step 2: Remove the search input's overflow-causing floor**

In `app/pages/music/index.vue`, replace lines 590-593:

```css
.music-search-input {
  flex: 1;
  min-width: 200px;
}
```

with:

```css
.music-search-input {
  flex: 1;
  /* min-width: 200px was a hard floor that exceeded the filters bar's own
     content box (192px) at a 320px viewport, even though the input already
     sits alone on its wrapped line. flex: 1 already sizes it sensibly at
     every wider width — dropping the floor lets it shrink the last few
     pixels instead of overflowing. */
  min-width: 0;
}
```

- [ ] **Step 3: Stack the artist detail header below 480px**

In `app/pages/music/index.vue`, replace lines 706-711:

```css
.artist-detail-header {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 32px;
}
```

with:

```css
.artist-detail-header {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 32px;
}

/* Mirrors channels.vue's .channel-profile-header stacking (same avatar+info
   header shape, already shipped and proven). Below 480px the 96px avatar +
   20px gap leave too little width for the info column to hold real content
   (a bio with an unbroken URL/email, or the "Lecture aléatoire" button) —
   no single child-level fix (word-break, button wrapping) closes the gap
   for every kind of content, but stacking the header removes the
   side-by-side width constraint entirely. */
@media (max-width: 480px) {
  .artist-detail-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}
```

- [ ] **Step 4: Make track rows shrink and scroll instead of silently clipping**

In `app/pages/music/index.vue`, replace lines 781-789:

```css
.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  cursor: pointer;
}
```

with:

```css
.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  cursor: pointer;
  /* .album-group (the ancestor card) has overflow: hidden, so without this
     a row whose fixed-size children (track number, duration, edit button,
     and — for an admin viewing a track with no clip yet — the wide
     "Télécharger le clip" button) exceed the available width gets its
     trailing controls silently clipped and unreachable. overflow-x: auto
     makes them reachable by scrolling the row instead. */
  overflow-x: auto;
}
```

Then replace lines 815-817:

```css
.track-title {
  flex: 1;
}
```

with:

```css
.track-title {
  flex: 1;
  /* Without min-width: 0 the title's automatic minimum size floors at its
     longest unbreakable word, which combined with the row's other
     flex-shrink: 0 children can still exceed the content box. Truncating
     with ellipsis instead of the current multi-line wrap also keeps the
     row a single, predictable height. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/pages/music/index.vue
git commit -m "fix: stop music catalog page overflowing at mobile widths

.artist-grid's minmax(220px, 1fr), .music-search-input's 200px floor,
.artist-detail-header's side-by-side avatar+info layout, and .track-row's
combination of a wrapping title with several flex-shrink: 0 controls
(including the admin-only clip-download button) all exceeded the content
box on real narrow viewports (measured on the GIMS artist, 28 tracks).
The header fix mirrors channels.vue's existing .channel-profile-header
stacking; the row fix adds overflow-x: auto so .album-group's overflow:
hidden no longer silently clips the trailing controls.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix podcasts/index.vue's four narrow-viewport overflows

**Files:**
- Modify: `app/pages/podcasts/index.vue:354-357` (`.podcast-search-input`), `:366-370` (`.show-grid`), `:415-420` (`.show-detail-header`), `:454-461` (`.episode-row`)
- Test: none (established convention)

**Interfaces:**
- Consumes: nothing from Task 1 — same bug shapes, independent CSS, no shared code between the two pages.
- Produces: `/podcasts`'s grid view and detail view stop overflowing their container at every width from 320px up. Task 3 re-measures `.content-area`'s `scrollWidth - clientWidth` on this route to assert this.

- [ ] **Step 1: Cap the show-grid track minimum at the container width**

In `app/pages/podcasts/index.vue`, replace lines 366-370:

```css
.show-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}
```

with:

```css
.show-grid {
  display: grid;
  /* Same fix as music/index.vue's .artist-grid: minmax()'s 220px minimum is
     a hard floor, overflowing any content box under ~350px. No-op at every
     width where 220px fits. */
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 20px;
}
```

- [ ] **Step 2: Remove the search input's overflow-causing floor**

In `app/pages/podcasts/index.vue`, replace lines 354-357:

```css
.podcast-search-input {
  flex: 1;
  min-width: 200px;
}
```

with:

```css
.podcast-search-input {
  flex: 1;
  /* Same fix as music/index.vue's .music-search-input: the 200px floor
     exceeded the filters bar's content box at a 320px viewport even though
     the input already sits alone on its wrapped line. */
  min-width: 0;
}
```

- [ ] **Step 3: Stack the show detail header below 480px**

In `app/pages/podcasts/index.vue`, replace lines 415-420:

```css
.show-detail-header {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 32px;
}
```

with:

```css
.show-detail-header {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 32px;
}

/* Same fix as music/index.vue's .artist-detail-header, mirroring
   channels.vue's existing .channel-profile-header stacking. Below 480px
   the 140px cover + 20px gap leave too little width for the info column
   (title, author, description) to hold real content without overflowing. */
@media (max-width: 480px) {
  .show-detail-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}
```

- [ ] **Step 4: Make episode rows scroll instead of silently clipping**

In `app/pages/podcasts/index.vue`, replace lines 454-461:

```css
.episode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
}
```

with:

```css
.episode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  /* .episode-main already has min-width: 0 (line 467-470), but the play
     button, the status badge, and (for an admin) the edit button are all
     effectively fixed-size and their combined width can still exceed the
     row's content box at a 320px viewport. overflow-x: auto makes any
     excess reachable by scrolling the row instead of leaving it clipped
     by an ancestor's overflow: hidden. */
  overflow-x: auto;
}
```

- [ ] **Step 5: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/pages/podcasts/index.vue
git commit -m "fix: stop podcasts catalog page overflowing at mobile widths

.show-grid's minmax(220px, 1fr), .podcast-search-input's 200px floor,
.show-detail-header's side-by-side cover+info layout, and .episode-row's
combination of a play button, status badge, and edit button all exceeded
the content box on real narrow viewports (measured on the Planet Money
show, 356 episodes). The header fix mirrors channels.vue's existing
.channel-profile-header stacking, applied identically to music/index.vue's
.artist-detail-header in the previous commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Manual end-to-end verification — real-browser width sweep

This is the task the Global Constraints mandate: measured rendered layout on the actual committed code, not a re-read of the audit's own numbers (which were gathered live but before these exact diffs existed as committed code).

**Files:**
- Modify: none
- Test: none automated — this task is the verification

**Interfaces:**
- Consumes: `.artist-grid`, `.music-search-input`/`.music-filters-bar`, `.artist-detail-header`, `.track-row`/`.track-title` (Task 1); `.show-grid`, `.podcast-search-input`/`.podcast-filters-bar`, `.show-detail-header`, `.episode-row` (Task 2); `.content-area` from the layout.
- Produces: a pass/fail record for every swept width and route, plus a `git diff --stat` proving only the two page files changed. Nothing downstream consumes it — this is the final task.

- [ ] **Step 1: Start the dev server and log in**

`.claude/launch.json`'s `youkeep-dev` configuration already exists (created by a prior sub-project). Start it via the browser-preview tool (`preview_start` with `name: "youkeep-dev"`).

The dev-login fixture (`POST /api/dev/login`) needs `ALLOW_DEV_LOGIN=1` in the server's environment and a matching CSRF token. If `/Users/light/Git/youkeep/.env` does not already contain `ALLOW_DEV_LOGIN=1`, add it (create the file if absent) and restart the dev server so it picks up the new environment variable — `.env` is gitignored, so this is a local-only, no-commit change. Then, in the browser:

```js
const csrf = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))?.split('=')[1];
await fetch('/api/dev/login', { method: 'POST', headers: {'content-type':'application/json', 'x-csrf-token': csrf}, body: '{}' }).then(r => r.status)
```

Expected: `200`. (If it returns `403` with a CSRF error on the very first attempt, reload the page once first so the CSRF cookie is set, then retry — the middleware only issues that cookie on a GET request.)

- [ ] **Step 2: Find real test content**

```js
const artists = await fetch('/api/music/artists').then(r=>r.json());
const shows = await fetch('/api/podcasts/shows').then(r=>r.json());
({ artistId: artists.artists?.[0]?.id, showId: shows.shows?.[0]?.id })
```

Expected: at least one artist and one show. Use their ids in the steps below. (This plan's own audit used artist `3b6243c7-b8d7-4b37-be75-25e8906a5cdb` (GIMS) and show `57f8f9ef-9d17-48ea-8b08-216149502070` (Planet Money) — if the same archive is still in place, these ids can be used directly instead of re-querying.)

- [ ] **Step 3: Sweep both pages' grid views**

For each route `/music` and `/podcasts`, at each width in **1440, 1024, 900, 768, 640, 600, 480, 414, 375, 340, 320** (set with `resize_window`, reloading after each resize so load-time gates re-run), run:

```js
(() => {
  const ca = document.querySelector('.content-area');
  const grid = document.querySelector('.artist-grid, .show-grid');
  const filters = document.querySelector('.music-filters-bar, .podcast-filters-bar');
  return {
    route: location.pathname,
    width: window.innerWidth,
    caOverflow: ca ? ca.scrollWidth - ca.clientWidth : 'n/a',
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    gridOverflow: grid ? grid.scrollWidth - grid.clientWidth : 'n/a',
    filtersOverflow: filters ? filters.scrollWidth - filters.clientWidth : 'n/a'
  };
})()
```

Expected: `caOverflow <= 0`, `docOverflow <= 0`, `gridOverflow <= 0`, `filtersOverflow <= 0` at **every** width on **both** routes. Before Tasks 1-2 this returns `gridOverflow: 28` and `filtersOverflow: 8` at 320px on both routes; after them both must read `0`.

- [ ] **Step 4: Sweep both pages' detail-view headers**

Navigate to `/music?artistId=<id>` and `/podcasts?showId=<id>` (using the ids from Step 2). At each width in **1440, 900, 600, 480, 481, 414, 375, 320** (481 is included specifically to confirm the new media query's boundary does not affect anything just above it), run:

```js
(() => {
  const header = document.querySelector('.artist-detail-header, .show-detail-header');
  return {
    route: location.pathname,
    width: window.innerWidth,
    headerOverflow: header ? header.scrollWidth - header.clientWidth : 'n/a',
    flexDirection: header ? getComputedStyle(header).flexDirection : 'n/a'
  };
})()
```

Expected: `headerOverflow <= 0` at every width on both routes. `flexDirection` is `"column"` at 480px and below, `"row"` at 481px and above — confirming the media query boundary is exactly where intended and does not leak into desktop layouts.

- [ ] **Step 5: Sweep the track/episode rows**

On the music artist detail page, expand the "Titres sans album" group (or any album) by clicking its `.album-header`. On the podcast show detail page, episodes are already listed. At each width in **900, 600, 480, 375, 320**, run:

```js
(() => {
  const rows = Array.from(document.querySelectorAll('.track-row, .episode-row'));
  const ca = document.querySelector('.content-area');
  return {
    route: location.pathname,
    width: window.innerWidth,
    caOverflow: ca.scrollWidth - ca.clientWidth,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    worstRowInternalOverflow: rows.length ? Math.max(...rows.map(r => r.scrollWidth - r.clientWidth)) : 'n/a'
  };
})()
```

Expected: `caOverflow <= 0` and `docOverflow <= 0` at every width on both pages — `worstRowInternalOverflow` is recorded but NOT a pass/fail gate on its own (individual rows are allowed to internally need more width than they have, since `overflow-x: auto` makes that reachable by scroll rather than a page-level bug; what matters is that it does not propagate to `.content-area` or the document).

- [ ] **Step 6: Hit-test that a previously-clipped row control is reachable by scroll, not just present in the DOM**

At 320px, on the music artist detail page with the album/standalone group expanded, find a `.track-row` whose `scrollWidth - clientWidth > 0`, then:

```js
(() => {
  const rows = Array.from(document.querySelectorAll('.track-row'));
  const row = rows.find(r => r.scrollWidth - r.clientWidth > 0);
  if (!row) return { found: false };
  const before = row.scrollLeft;
  row.scrollLeft = 9999;
  const after = row.scrollLeft;
  return { found: true, before, after, scrolled: after > before };
})()
```

Expected: `found: true` and `scrolled: true` — the row actually scrolls, proving its trailing controls (duration, edit button, clip-download button) are reachable rather than permanently hidden by `.album-group`'s `overflow: hidden`.

- [ ] **Step 7: Confirm the two clean-verified modals are still clean, and document the third**

Open `MusicTrackEditModal` (click a track's edit button) and `PodcastEpisodeEditModal` (click an episode's edit button) at 320px, and for each run:

```js
(() => {
  const modal = document.querySelector('.modal-card');
  return { found: !!modal, overflow: modal ? modal.scrollWidth - modal.clientWidth : 'n/a' };
})()
```

Expected: `found: true` and `overflow: 0` for both. `MusicAlbumEditModal` cannot be opened unless the test data includes an artist with at least one album (the audit's own dataset — GIMS — has none); if no such album exists, record that explicitly in the verification report rather than silently omitting it. If an album IS available, verify it the same way and expect the same result.

- [ ] **Step 8: Confirm no other file was touched**

Run: `cd /Users/light/Git/youkeep && git diff --stat main -- app/`

Expected: exactly two files listed — `app/pages/music/index.vue` and `app/pages/podcasts/index.vue`. Any other file appearing means work was done outside the audit's findings — revert it.

- [ ] **Step 9: Stop the dev server**

Stop the preview server. No commit is needed for this task (the `.env` change from Step 1, if made, is gitignored and intentionally not committed).

---

## Self-Review

Run at the end of writing, against the design spec at `docs/superpowers/specs/2026-09-07-music-podcasts-catalog-responsive-audit-design.md`.

### 1. Spec coverage

| Spec requirement | Where it lands | Outcome |
|---|---|---|
| Audit `music/index.vue`'s `.artist-grid` | Audit §1 | **Bug confirmed** (smaller radius than suspected — overflows below ~350px, not safe as the design phase guessed) → Task 1 |
| Audit `podcasts/index.vue`'s `.show-grid` | Audit §1 | **Bug confirmed**, identical shape → Task 2 |
| Audit `.music-filters-bar`/`.podcast-filters-bar` | Audit §2 | **Bug confirmed** — the search input's `min-width: 200px` floor, not the selects → Task 1/2 |
| Audit artist/show detail headers | Audit §3 | **Bug confirmed** — the largest bug found, root-caused via live CSS toggling to the avatar/cover's fixed size leaving too little room for any real content in the info column, not any single child element → Task 1/2 |
| Audit `.track-row`/`.track-title` | Audit §4 | **Bug confirmed** — the design spec's own suspicion (missing `min-width: 0`) was necessary but not sufficient; the admin-only `.clip-download-btn` is the dominant cause, and `.album-group`'s `overflow: hidden` makes it a silent-clipping bug, not just a scrollbar → Task 1 |
| Audit `.episode-row`/`.episode-main` | Audit §5 | **Bug confirmed**, smaller magnitude — `.episode-main` was already correctly configured as the spec noted, but the play/badge/edit controls together still overflow at 320px → Task 2 |
| Audit the 3 edit modals | Audit §6 | **2 of 3 verified clean live**; 3rd undeterminable with current archive data (no albums exist), documented rather than assumed → Task 3 Step 7 |
| Global Constraint — no `BaseModal.vue` changes | Not touched anywhere in this plan | Covered |
| Global Constraint — no Settings changes | Not touched anywhere in this plan | Covered |
| Global Constraint — no card redesign | All fixes are CSS-value changes (grid track, min-width, overflow-x, one media query reusing an existing pattern) — no template/structure changes anywhere | Covered |
| Global Constraint — established idioms only | `min(px,100%)` for grids (idiom #1), dropping a `min-width` floor (a direct instance of the same underlying principle as idiom #2's max-width+min-width:0 pairing — no explicit width existed here to cap, so there was nothing to add `max-width` to), `overflow-x: auto` for unfittable rows (idiom #3, already used identically for `.playlists-row`/`.channels-row`/`.channel-tabs-bar`), and the header-stacking media query (already shipped verbatim for `channels.vue`) | Covered — no new pattern invented |
| Verification — real-browser measurement at the full width sweep | Task 3 | Covered, including a specific 480/481px boundary check the design spec did not explicitly request but which the media-query fix makes necessary |

No gap found. Every spec section maps to a task or to a recorded audit outcome.

**A note on how this audit differs from the prior sub-project's:** unlike sub-project 2's audit (pure static file reading — every bug there was a fixed pixel value computable without a browser), two of this sub-project's bugs (the detail header, the track/episode rows) depend on real content (an email address in a bio, an admin-only button, a status badge) whose rendered width cannot be computed from the CSS alone. This audit was therefore done live, in a real browser, against real archived data, with each candidate fix tested in place (via an injected `<style>` override) before being written into this plan as the final diff — including one case (the detail header) where the first fix attempted (word-break + button-wrap, three separate rules) was found to work but was superseded by a single, simpler, already-established rule (header stacking) that fixed the same bug with less code and less bug-shape-specific reasoning.

### 2. Placeholder scan

Searched for `TBD`, `TODO`, `implement later`, `fill in details`, `add appropriate error handling`, `add validation`, `handle edge cases`, `write tests for the above`, `similar to Task N`, and any step describing a change without showing it.

- Every CSS step in Tasks 1-2 shows the full before-and-after block.
- Task 2 does not say "same as Task 1" without also restating the full rule — both tasks are independently complete and readable in isolation, even though the underlying reasoning (documented once, in the Audit Results) is shared.
- Task 3's browser steps show the complete JS snippet and the exact numeric/boolean pass condition.
- Task 3 Step 7 explicitly handles the one place this plan could not fully verify (the album modal) by requiring the outcome to be *documented*, not silently assumed — this is a deliberate, honest gap, not a placeholder.

### 3. Type and signature consistency

- Every CSS selector used in the tasks and in Task 3's snippets was confirmed to exist in the current on-disk files at the stated line numbers: `.artist-grid` (`music/index.vue:657`), `.music-search-input` (`:590`), `.artist-detail-header` (`:706`), `.track-row`/`.track-title` (`:781`, `:815`), `.show-grid` (`podcasts/index.vue:366`), `.podcast-search-input` (`:354`), `.show-detail-header` (`:415`), `.episode-row`/`.episode-main` (`:454`, `:467`). `.artist-detail-info`/`.show-detail-info` (the info column inside each header) were confirmed to carry **no CSS rule of their own at all** — a plain, unstyled `<div>` — which is exactly why the fix touches only the outer header (adding the stacking media query), not the info column: there was nothing narrower to target.
- The media-query breakpoint (480px) and its exact three declarations (`flex-direction: column; align-items: center; text-align: center;`) are used identically in both Task 1 and Task 2, matching each other and matching `channels.vue`'s existing, shipped `.channel-profile-header` rule (`app/pages/channels.vue:335-341`) — same three declarations, different selector and breakpoint value (480 here vs. 600 there, justified in Audit §3 by where each page's own overflow was independently measured to resolve).
- Test command is `npm test` → `vitest run`, taken from `package.json:11` (same as every prior sub-project in this initiative).
- The dev-login CSRF flow in Task 3 Step 1 was worked out and confirmed live during this plan's own audit (a plain `POST /api/dev/login` returns 403 with a CSRF error on a browser tab that already carries a stale session cookie; reading the `csrf_token` cookie and sending it back as the `x-csrf-token` header succeeds) — this is new information not present in any prior sub-project's plan, recorded here so Task 3 does not have to rediscover it.
