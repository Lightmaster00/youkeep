# Settings Responsive Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the eight confirmed narrow-viewport overflow bugs found by a real-browser audit of all 6 Settings tabs (Dashboard/Stats, Downloads, Music, Podcasts, Users, System), then verify every fix by real-browser width-sweep measurement.

**Architecture:** All CSS for the Settings page and all 6 tab components lives in exactly one place — `app/pages/settings.vue`'s single unscoped `<style>` block — so every fix in this plan is a change to that one file, even though the bugs live inside child-component templates. Six of the eight bugs are shared across the Downloads/Music/Podcasts tabs because those three tabs render structurally identical markup with the same class names (an ingest/queue-management UI pattern copy-pasted three times); fixing the shared CSS rule once resolves all three tabs at once. The other two bugs are specific to the Users tab. Every fix reuses an idiom already established and merged elsewhere in this app: `minmax(min(<px>,100%),1fr)` for grid tracks, `flex-wrap: wrap` for an unwrappable row of fixed-size siblings, ellipsis truncation for a text element whose intrinsic content width exceeds its box, and `width: 100%` for a native `<select>` that was never given the `width: 100%` its sibling `.form-input` class already has.

**Tech Stack:** Nuxt 4 (Vue 3 `<script setup>`, SFC unscoped `<style>`), Nitro, better-sqlite3, Vitest 4 + happy-dom + `@vue/test-utils` (`npm test` → `vitest run`).

## Global Constraints

- No changes to the password-change-required flow.
- No changes to `/account`.
- No card-based mobile layout redesign for any list/row content — overflow fixes only, not layout philosophy changes.
- No new automated tests for this bug class — CSS overflow has no automated coverage anywhere in this codebase; verification is real-browser measurement only.
- Fixes reuse the already-established idioms verbatim: `minmax(min(<px>px, 100%), 1fr)` for grid tracks; `flex-wrap: wrap` for an unwrappable row of `flex-shrink: 0` siblings; ellipsis truncation (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`) for a text element whose content forces overflow; `width: 100%` for a form control missing the sizing its sibling classes already have. Do not invent a new pattern for a bug shape this codebase has already solved.
- Every claimed fix is backed by real-browser before/after `scrollWidth - clientWidth` measurement at 320/340/375/480/600/900px minimum.
- A fix to a CSS rule shared by multiple tabs (`.concurrency-control`, `.queue-card-channel-name`, `.search-results-grid`, `.search-channel-card`, `.channel-search-meta`, `.form-select`) must be independently re-verified on every tab that renders it, not assumed to generalize from one tab's measurement.

---

## Audit Results

This section is the completed investigation, done directly against the running app (dev server + real browser, logged in via the `POST /api/dev/login` fixture, `ALLOW_DEV_LOGIN=1` in a local, gitignored `.env`), using real data already in the dev database: a Downloads queue with a failed video (long yt-dlp error log, long title), a Music queue (100 items, artist GIMS), Podcasts history (show "Planet Money"), 2 real user accounts, and live channel/artist search results (20 real YouTube channel search results on the Downloads tab; GIMS as an already-tracked artist on the Music tab).

Every candidate the design spec flagged was measured, not assumed. Both of its named candidates (`.search-results-grid`, `.users-list-grid`) were confirmed real bugs — but each turned out to need a SECOND, co-located fix beyond the grid-track minimum alone, found only by isolating each bug's true root cause through live CSS toggling rather than stopping at the first plausible explanation.

### Method

For each tab: navigate to it (via clicking its `.tab-btn` — see the "Real navigation gotcha" note below, NOT via `?tab=` query string for the Music tab), resize to 320px, and run this isolation snippet to find every element whose own box overflows its container without an ancestor already absorbing it via `overflow-x`:

```js
function findRealOverflow(root) {
  const results = [];
  const walk = (node) => {
    for (const c of node.children) {
      const cs = getComputedStyle(c);
      const ov = c.scrollWidth - c.clientWidth;
      if (ov > 3 && cs.overflowX !== 'hidden' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
        results.push({ cls: c.className, tag: c.tagName, overflow: ov, text: c.textContent?.trim().slice(0,50) });
      }
      walk(c);
    }
  };
  walk(root);
  return results.sort((a,b)=>b.overflow-a.overflow).slice(0,10);
}
findRealOverflow(document.querySelector('.settings-content'))
```

Each hit was then traced to its true cause (which is not always the flagged element itself — e.g. `.downloads-header-panel` reporting 40px of overflow turned out to be caused by `.concurrency-control` two levels down, not by anything in the panel itself) by walking its children/CSS one level at a time, and every candidate fix was tested in place via an injected `<style>` override, measuring `.content-area`'s `scrollWidth - clientWidth` before and after, before being written into this plan.

**Real navigation gotcha found during this audit:** `app/pages/settings.vue:96`'s `allowedTabs` array is `['stats', 'downloads', 'podcasts', 'users', 'system']` — it is **missing `'music'`**. Navigating to `/settings?tab=music` silently falls back to the Stats tab instead of opening Music. This is a real, separate bug (a routing bug, not a CSS/responsive one) — **out of scope for this plan** per the spec's file boundaries, not fixed here. Flagged for a follow-up task. During this audit, the Music tab was reached by clicking its `.tab-btn` directly, not via the query string, and Task 3's verification must do the same.

**A second navigation gotcha**: the page has a **global header search input** with placeholder `"Search videos, channels..."` that is easy to accidentally query-match against a loose CSS selector like `input[placeholder*="hannel"]` (both "channels" and "Channel name" contain "hannel"). The Downloads tab's own channel-tracking search input has the distinct placeholder `"Channel name (e.g. Marques Brownlee, Veritasium...)"` — always scope input queries to `document.querySelector('.settings-content').querySelector(...)` to avoid the global header input entirely.

### Per-bug findings

#### 1. `.concurrency-control` — **BUG CONFIRMED, shared by Downloads/Music/Podcasts**

`app/components/settings/SettingsDownloadsTab.vue:23`, `SettingsMusicTab.vue:43`, `SettingsPodcastsTab.vue:21` all contain the identical inline style:

```html
<div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
```

`.concurrency-control` has **no CSS rule anywhere** — its layout comes entirely from this inline style, which sets `display`/`align-items`/`gap` but no `flex-wrap`, defaulting to `nowrap`. Its three children (a label "Max concurrent downloads", a number input, a "Save" button) measured 67 + 64 + 58 = 189px plus gaps, needing ~205.7px, while the row's own available width at a 320px viewport is 192px on Downloads/Music and slightly less on Podcasts (both measured to overflow).

| Tab | `.content-area` overflow at 320px (before) |
|---|---|
| Downloads | 15px |
| Music | 15px |
| Podcasts | 15px (10px remaining after this fix alone — see bug 6) |

**Fix:** a NEW CSS rule (this class has none today) with only `flex-wrap: wrap` — inline styles set no `flex-wrap`, so a class rule adding it does not conflict with or need to override anything the inline style already declares.

#### 2. `.queue-card-channel-name` — **BUG CONFIRMED, shared by Downloads/Music/Podcasts**

`app/pages/settings.vue:1658-1661`:

```css
.settings-container .queue-card-channel-name {
  font-size: 11.5px;
  color: var(--text-secondary);
}
```

Its sibling in the same card, `.queue-card-title` (`settings.vue:1648-1656`), already has full ellipsis truncation (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`) — `.queue-card-channel-name` was simply never given the same treatment. With a real channel name like "DirtyBiology" (12 unbreakable characters, no spaces to wrap on), the span renders at its full 67px intrinsic width inside a 34.5px box, visually spilling into whatever sits next to it (confirmed live: before the fix, the title and channel-name rows visually collided; after, both show a clean single-line ellipsis, confirmed by screenshot on the Downloads tab with a real failed-download queue item).

**Fix:** add the identical three declarations `.queue-card-title` already uses.

#### 3. `.search-results-grid` — **BUG CONFIRMED (the design spec's own candidate), shared by Downloads/Music/Podcasts**

There are **two** rules named `.search-results-grid` in `settings.vue` — a dead one at `:992-999` (`display: flex; flex-direction: column; ...`, fully overridden by the second rule redeclaring `display` later in the cascade — confirmed dead, not touched by this plan) and the live one at `:1518-1525`:

```css
.settings-container .search-results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 6px;
}
```

Confirmed live on all three tabs with real content (20 real YouTube search results on Downloads, GIMS as a followed artist on Music, "Planet Money" on Podcasts): `.search-results-grid`'s own overflow was 172px (Downloads), 164px (Music), and a comparable value on Podcasts, all at a 320px viewport — the largest-magnitude bug found in this sub-project, and larger than any `minmax()` value fixed so far in this initiative (300px vs. the previous max of 295px).

**Fix:** the established `min(300px, 100%)` wrap. This alone does NOT fully resolve the bug — see #4 and #5, both nested inside cards this grid produces, and both needed in addition.

#### 4. `.search-channel-card` — **BUG CONFIRMED, shared by Downloads/Music/Podcasts — the design spec did not anticipate this one**

`app/pages/settings.vue:1001-1010`:

```css
.settings-container .search-channel-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: all 0.2s;
}
```

Once the `.search-results-grid` track minimum is fixed (#3), each card gets the real content-box width available (~128-136px at 320px) instead of a floored 300px. But the card's own row layout — a 50px fixed avatar, a flexible info column, and two action buttons (`~47px` and `~55px`) — cannot fit inside 128-136px even with the info column collapsed to zero: avatar + buttons + gaps alone need ~200px. This is the same shape as sub-project 3's `.artist-detail-header`/`.show-detail-header` bug (a fixed avatar/cover leaving too little room for a side-by-side layout at narrow widths), not something a single child-level fix (like ellipsis on the text) can close, because the OTHER fixed-size siblings (avatar, buttons) already exceed the available width on their own.

**Fix, verified live**: the exact same idiom sub-project 3 used for this exact shape — stack the card vertically below 480px:

```css
@media (max-width: 480px) {
  .search-channel-card { flex-direction: column; align-items: stretch; }
}
```

Confirmed on Downloads (real search results) and Music (GIMS) tabs: `.content-area`'s overflow reaches 0px at 320px with this rule plus #3 and #5 combined; without it, `.search-channel-card` itself still internally overflowed by 25-53px even after #3 alone.

#### 5. `.channel-search-meta` — **BUG CONFIRMED, shared by Downloads/Music/Podcasts**

`app/pages/settings.vue:1041-1045`:

```css
.settings-container .channel-search-meta {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}
```

Its sibling `.channel-search-info h5` (`:1031-1039`, the channel/artist name) already has full ellipsis truncation. `.channel-search-meta` (the "Downloading•public•356 episode(s)"-style status line) was never given the same treatment — the exact same oversight pattern as bug #2 (`.queue-card-title` vs. `.queue-card-channel-name`): one element in a pair got the idiom, its sibling didn't.

**Fix:** add the same three ellipsis declarations `.channel-search-info h5` already uses.

#### 6. `.form-select` — **BUG CONFIRMED, shared by Downloads/Music/Podcasts, and the design spec's static scan could not have found it**

`.form-select` (used 7 times across `SettingsDownloadsTab.vue`, `SettingsMusicTab.vue`, `SettingsPodcastsTab.vue` for preset-interval and visibility `<select>` elements) has **no CSS rule anywhere in this codebase** — confirmed by grepping the entire `app/` tree. Its sibling class, `.form-input`, has `width: 100%` in `app/assets/css/main.css:148` — `.form-select` was simply never given the matching rule. Without it, a native `<select>` falls back to the browser's default content-based sizing, which sizes the element to fit its widest `<option>` text (e.g. "Every 12 hours" or "Keep current (Public if new)") regardless of its container's width. Confirmed live on the Podcasts tab: `.schedule-settings-row` (`settings.vue:636-647`, already correctly collapsing to a single grid column at ≤600px) still overflowed by 59px at 320px because the `<select>` inside its single remaining column refused to shrink below its content width. `max-width: 100%` alone was tested and found **inert** (the browser's default select-sizing algorithm does not respect `max-width` the way a normal block element would); only `width: 100%` (matching `.form-input`'s own convention) fixed it — confirmed: `.content-area`'s overflow went from 10px (the residual after fixing #1 on Podcasts) to 0px, and the select's rendered width became 142px (its container's full width) instead of its 165-179px content-driven default.

**Fix:** add `.settings-container .form-select { width: 100%; }`, matching `.form-input`'s established convention. (`max-width: 100%` was also tested for good measure alongside it — harmless, kept for the same defensive reason `.form-input` doesn't need it since `width: 100%` already fully constrains it — but `width: 100%` is what actually does the work.)

#### 7. `.users-list-grid` — **BUG CONFIRMED (the design spec's other named candidate), Users tab only**

`app/pages/settings.vue:2051-2055`:

```css
.settings-container .users-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
```

Confirmed live with 2 real user accounts: `.content-area` overflowed 109px at 320px, `.users-list-grid` itself 158px.

**Fix:** the established `min(300px, 100%)` wrap. Same as #3, this reduces but does not eliminate the overflow — two more co-located bugs (#8 and #9) live inside the register-account form and inside each user card.

#### 8. `.role-selector-premium` — **BUG CONFIRMED, Users tab only**

`app/pages/settings.vue:1847-1851`:

```css
.settings-container .role-selector-premium {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
```

Its two `.role-card` children (`:1853-1856`, each `flex: 1`) are the "Standard User" / "Administrator" account-type toggle in the registration form. With no `flex-wrap`, the two cards (measured at 82.7px and 109px, needing ~204px combined) don't fit the 142px row at a 320px viewport.

**Fix:** add `flex-wrap: wrap`. Confirmed live: `.content-area`'s overflow (62px, attributable to this element per the isolation trace) reached 0px, and each `.role-card` (already `flex: 1`) correctly stacks to its own full-width row when wrapped — confirmed by screenshot, no layout regression.

#### 9. `.user-headline-col` (+ its `h4` and `.badge` children) — **BUG CONFIRMED, Users tab only**

`app/pages/settings.vue:1989-1993` (the column holding each user card's username + role badge):

```css
.settings-container .user-headline-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
```

has no `min-width: 0`, and its `h4` (`:1995-2000`, the username) has no truncation. With a real username ("dev-fixture-admin", 18 unbreakable characters) inside a card whose avatar (`user-avatar-circle`, 42px) and fixed layout leave only ~104px total for the header row, the column's automatic minimum size floors at the username's full ~117px width, overflowing the row. The role `.badge` inside the same column (global `.badge` class, `app/assets/css/main.css:310-318`, `display: inline-flex`) has the identical shape — "Administrator" is one unbreakable word with no truncation, also overflowing once the column is finally allowed to shrink.

**Fix, verified live in two steps** (confirmed each step's contribution separately):
1. `.user-headline-col { min-width: 0; }` lets the column actually shrink instead of being floored by its content.
2. `.user-headline-col h4 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }` — added alongside the existing `h4` rule's properties, same idiom as bugs #2/#5.
3. A NEW scoped rule `.user-headline-col .badge { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; }` — scoped to `.user-headline-col .badge` specifically (NOT the global `.badge` class, which is used elsewhere in the app and must not be touched) so only this context's badges get truncated.

Confirmed: `.content-area`'s overflow reached 0px with all three changes; without any one of them, some residual overflow remained (min-width:0 alone still left the h4 at its full width; adding h4 ellipsis without the badge fix left the badge still overflowing internally).

### Audit summary

| # | Element | File:Lines | Outcome | Tabs affected |
|---|---|---|---|---|
| 1 | `.concurrency-control` | `settings.vue` (new rule, insert after `:396`) | **BUG** → Task 1 | Downloads, Music, Podcasts |
| 2 | `.queue-card-channel-name` | `settings.vue:1658-1661` | **BUG** → Task 1 | Downloads, Music, Podcasts |
| 3 | `.search-results-grid` (live rule) | `settings.vue:1518-1525` | **BUG**, largest found → Task 1 | Downloads, Music, Podcasts |
| 4 | `.search-channel-card` | `settings.vue:1001-1015` (new media query) | **BUG**, not spec-anticipated → Task 1 | Downloads, Music, Podcasts |
| 5 | `.channel-search-meta` | `settings.vue:1041-1045` | **BUG** → Task 1 | Downloads, Music, Podcasts |
| 6 | `.form-select` | `settings.vue` (new rule) | **BUG**, not spec-anticipated → Task 1 | Downloads, Music, Podcasts |
| 7 | `.users-list-grid` | `settings.vue:2051-2055` | **BUG** (spec's other candidate) → Task 2 | Users |
| 8 | `.role-selector-premium` | `settings.vue:1847-1851` | **BUG** → Task 2 | Users |
| 9 | `.user-headline-col` + `h4` + new `.badge` rule | `settings.vue:1989-2000` (+ new rule) | **BUG** → Task 2 | Users |
| — | Stats tab | `SettingsStatsTab.vue` | **Clean** — already fixed by two prior follow-up sub-projects this session (`.metrics-grid`, `.banner-quick-stats`); reconfirmed clean at 320px with no fix disabled | Stats |
| — | System tab | `SettingsSystemTab.vue` | **Clean** — confirmed 0px overflow at 320px with all other tabs' fixes disabled (i.e. genuinely clean, not incidentally fixed by something else) | System |
| — | `allowedTabs` missing `'music'` | `settings.vue:96` | **Real bug, out of scope** — a routing bug, not CSS/responsive. Not fixed here; flagged for a follow-up task after this plan ships. | Music (deep-link only) |

No pure, testable logic was surfaced — every bug is a declarative CSS value or a missing CSS rule. Per the Global Constraints, no automated tests are added; verification is Task 3's real-browser width sweep plus each fix task's own re-measurement.

---

## File Structure

| File | Change |
|---|---|
| `app/pages/settings.vue` | Modify — 9 CSS changes across 2 tasks (all in the single `<style>` block; no other file has any CSS to change, per the Architecture note above) |

No new source files, no test files, no changes to any `.vue` component file (all 6 tab components' templates are read-only for this plan — every fix is CSS-only, in `settings.vue`).

---

### Task 1: Fix the shared Downloads/Music/Podcasts overflow bugs

**Files:**
- Modify: `app/pages/settings.vue:392-396` (insert `.concurrency-control` after), `:1001-1015` (`.search-channel-card` — insert media query after), `:1041-1045` (`.channel-search-meta`), `:1518-1525` (`.search-results-grid`, the live rule), `:1658-1661` (`.queue-card-channel-name`), plus one new `.form-select` rule
- Test: none (established convention — no automated tests for this bug class)

**Interfaces:**
- Consumes: nothing from other tasks. All changes are self-contained CSS inside `settings.vue`'s own `<style>` block.
- Produces: the Downloads, Music, and Podcasts tabs stop overflowing their container at every width from 320px up, on both the queue-card list and the search/followed-artist grid. Task 3 re-measures `.content-area`'s `scrollWidth - clientWidth` on all three tabs to assert this.

- [ ] **Step 1: Let the concurrency-control row wrap**

In `app/pages/settings.vue`, find lines 392-396:

```css
.settings-container .queue-actions-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
```

Immediately after this rule (before the `/* Queue List */` comment on line 398), insert a new rule:

```css

/* .concurrency-control has no CSS of its own — its layout comes entirely
   from an inline style (`display: inline-flex; align-items: center; gap:
   8px;`) repeated identically in SettingsDownloadsTab.vue,
   SettingsMusicTab.vue, and SettingsPodcastsTab.vue. That inline style sets
   no flex-wrap, defaulting to nowrap, so the label + number input + Save
   button (needing ~205px combined) overflowed the row at a 320px viewport
   (~192px available). A class rule can add flex-wrap without conflicting
   with the inline style, since the inline style never sets it. */
.settings-container .concurrency-control {
  flex-wrap: wrap;
}
```

- [ ] **Step 2: Stack the search-channel-card below 480px**

In `app/pages/settings.vue`, find lines 1001-1015:

```css
.settings-container .search-channel-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: all 0.2s;
}

.settings-container .search-channel-card:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}
```

Replace it with (adding a new media query after the existing `:hover` rule, leaving both existing rules unchanged):

```css
.settings-container .search-channel-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: all 0.2s;
}

.settings-container .search-channel-card:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

/* Below 480px, the 50px avatar + two action buttons already exceed the
   available width on their own (measured ~200px needed vs. ~128-136px
   available at 320px) — no child-level fix (ellipsis, min-width) can close
   that gap, because the fixed-size siblings are the problem, not the
   flexible text column. Stacking removes the side-by-side constraint
   entirely, mirroring the identical fix already used for
   .artist-detail-header / .show-detail-header. */
@media (max-width: 480px) {
  .settings-container .search-channel-card {
    flex-direction: column;
    align-items: stretch;
  }
}
```

- [ ] **Step 3: Truncate the channel/artist search meta line**

In `app/pages/settings.vue`, find lines 1041-1045:

```css
.settings-container .channel-search-meta {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}
```

Replace with:

```css
.settings-container .channel-search-meta {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
  /* Its sibling .channel-search-info h5 (the channel/artist name, a few
     lines above) already has this exact truncation. This line was simply
     never given the same treatment, and status text like
     "Downloading•public•356 episode(s)" cannot wrap (no breakable spaces
     around the bullet separators), so it overflowed its column. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 4: Cap the search-results-grid track minimum at the container width**

In `app/pages/settings.vue`, find lines 1518-1525 (the SECOND, live `.search-results-grid` rule — NOT the one at line 992, which is dead/fully-overridden CSS and must NOT be touched):

```css
.settings-container .search-results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 6px;
}
```

Replace with:

```css
.settings-container .search-results-grid {
  display: grid;
  /* min(300px, 100%) instead of a bare 300px: minmax()'s minimum is a hard
     floor, so on a content box narrower than 300px (any viewport under
     ~430px) the single column was wider than its container — the largest
     overflow bug found in this sub-project (up to 172px at 320px on the
     Downloads tab's real search results). No-op at every width where 300px
     fits. */
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 6px;
}
```

- [ ] **Step 5: Truncate the queue-card channel name**

In `app/pages/settings.vue`, find lines 1658-1661:

```css
.settings-container .queue-card-channel-name {
  font-size: 11.5px;
  color: var(--text-secondary);
}
```

Replace with:

```css
.settings-container .queue-card-channel-name {
  font-size: 11.5px;
  color: var(--text-secondary);
  /* Its sibling .queue-card-title (a few lines above) already has this
     exact truncation. This line was simply never given the same treatment
     — a real channel name like "DirtyBiology" (one unbreakable word) forced
     the span to its full intrinsic width, visually colliding with
     neighboring content in the card. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}
```

- [ ] **Step 6: Give .form-select the width its sibling .form-input already has**

In `app/pages/settings.vue`, find lines 1518-1525 (now shifted a few lines later after Step 4's edit — locate by the `.search-results-grid` rule you just edited in Step 4) and insert a new rule immediately after the closing `}` of that rule, before the `/* Custom forms integration */` comment:

```css

/* .form-select (the preset-interval / visibility <select> elements in the
   Downloads/Music/Podcasts ingestion forms) has no CSS rule anywhere in
   this codebase — unlike its sibling .form-input, which has width: 100% in
   main.css:148. Without it, a native <select> falls back to the browser's
   default content-based sizing (fitting its widest <option> text,
   e.g. "Every 12 hours"), ignoring its container's actual width.
   max-width: 100% alone was tested and found inert here — only width: 100%
   overrides a select's default sizing algorithm. */
.settings-container .form-select {
  width: 100%;
  max-width: 100%;
}
```

- [ ] **Step 7: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/pages/settings.vue
git commit -m "fix: stop Downloads/Music/Podcasts settings tabs overflowing at mobile widths

Six bugs, all shared across the three tabs because they render identical
markup: .concurrency-control's inline style had no flex-wrap;
.search-results-grid's minmax(300px, 1fr) never shrank below 300px (the
largest overflow bug in this sub-project, up to 172px at 320px);
.search-channel-card's avatar+buttons exceeded the available width even
after the grid fix, needing to stack below 480px; .channel-search-meta and
.queue-card-channel-name were each missing the exact ellipsis truncation
their sibling elements already had; .form-select had no width rule at all,
unlike its sibling .form-input.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix the Users-tab-only overflow bugs

**Files:**
- Modify: `app/pages/settings.vue:1847-1851` (`.role-selector-premium`), `:1989-2000` (`.user-headline-col` + its `h4`), `:2051-2055` (`.users-list-grid`), plus one new `.user-headline-col .badge` rule
- Test: none (established convention)

**Interfaces:**
- Consumes: nothing from Task 1 — disjoint line ranges within the same file, no shared selectors.
- Produces: the Users tab stops overflowing its container at every width from 320px up, on both the account-registration form and the user-list grid. Task 3 re-measures `.content-area`'s `scrollWidth - clientWidth` on this tab to assert this.

- [ ] **Step 1: Let the role selector wrap**

In `app/pages/settings.vue`, find lines 1847-1851:

```css
.settings-container .role-selector-premium {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
```

Replace with:

```css
.settings-container .role-selector-premium {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  /* The two .role-card children (each flex: 1, "Standard User" and
     "Administrator") needed ~204px combined at a 320px viewport, where the
     row's own available width was 142px. flex-wrap lets each card fall to
     its own full-width row instead of overflowing. */
  flex-wrap: wrap;
}
```

- [ ] **Step 2: Let the user card's headline column shrink and truncate**

In `app/pages/settings.vue`, find lines 1989-2000:

```css
.settings-container .user-headline-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-container .user-headline-col h4 {
  font-size: 14.5px;
  font-weight: 700;
  color: white;
  margin: 0;
}
```

Replace with:

```css
.settings-container .user-headline-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* Without this, the column's automatic minimum size is floored by its
     content (a real username like "dev-fixture-admin" has no breakable
     characters), which overflowed the ~104px header row at a 320px
     viewport even before considering the badge below. */
  min-width: 0;
}

.settings-container .user-headline-col h4 {
  font-size: 14.5px;
  font-weight: 700;
  color: white;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Scoped to .user-headline-col specifically — the global .badge class
   (main.css:310) is used elsewhere in the app and must not be changed.
   "Administrator" is one unbreakable word with the same shape as the h4
   username above: min-width: 0 lets it shrink, the rest truncates it. */
.settings-container .user-headline-col .badge {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
}
```

- [ ] **Step 3: Cap the users-list-grid track minimum at the container width**

In `app/pages/settings.vue`, find lines 2051-2055:

```css
.settings-container .users-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
```

Replace with:

```css
.settings-container .users-list-grid {
  display: grid;
  /* Same fix as .search-results-grid in Task 1: minmax()'s 300px minimum
     overflowed any content box under ~430px (measured 158px overflow at
     320px with 2 real user accounts). */
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  gap: 16px;
}
```

- [ ] **Step 4: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/pages/settings.vue
git commit -m "fix: stop Users settings tab overflowing at mobile widths

.users-list-grid's minmax(300px, 1fr) never shrank below 300px (158px
overflow at 320px with real accounts); .role-selector-premium's two
account-type cards had no flex-wrap; .user-headline-col had no min-width: 0
and its username/role-badge text had no truncation, unlike this codebase's
established convention for exactly this shape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Manual end-to-end verification — real-browser width sweep across all 6 tabs

This is the task the Global Constraints mandate: measured rendered layout on the actual committed code, not a re-read of the audit's own numbers (which were gathered live but before these exact diffs existed as committed code).

**Files:**
- Modify: none
- Test: none automated — this task is the verification

**Interfaces:**
- Consumes: `.concurrency-control`, `.search-channel-card`, `.channel-search-meta`, `.search-results-grid`, `.queue-card-channel-name`, `.form-select` (Task 1); `.role-selector-premium`, `.user-headline-col`, `.users-list-grid` (Task 2); `.content-area` from the layout.
- Produces: a pass/fail record for every swept width and tab, plus a `git diff --stat` proving only `app/pages/settings.vue` changed. Nothing downstream consumes it — this is the final task.

- [ ] **Step 1: Start the dev server and log in**

`.claude/launch.json`'s `youkeep-dev` configuration already exists. Start it via `preview_start` with `name: "youkeep-dev"`.

A local, gitignored `.env` with `ALLOW_DEV_LOGIN=1` should already exist at `/Users/light/Git/youkeep/.env` (left over from prior sub-projects' own audits) — check it's present; if missing, create it with exactly `ALLOW_DEV_LOGIN=1` (do not commit it, it is gitignored). Then, in the browser:

```js
const csrf = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))?.split('=')[1];
await fetch('/api/dev/login', { method: 'POST', headers: {'content-type':'application/json', 'x-csrf-token': csrf || ''}, body: '{}' }).then(r => r.status)
```

Expected: `200`. If it 403s on the very first attempt with a CSRF error, reload once first (the middleware only issues the CSRF cookie on a GET) and retry.

- [ ] **Step 2: Navigate to Settings and reach each tab correctly**

Navigate to `http://localhost:3000/settings`. **Do not** use `?tab=music` — `allowedTabs` (a separate, out-of-scope bug, see Audit Results) silently falls back to Stats for that one query value. Instead, for every tab including Music, click the tab's `.tab-btn` element directly:

```js
const btns = Array.from(document.querySelectorAll('.tab-btn'));
const tab = btns.find(b => b.textContent.includes('<Dashboard|Downloads|Music|Podcasts|Users|System>'));
tab.click();
await new Promise(r => setTimeout(r, 1000));
```

(Dashboard is the Stats tab's button label.)

When querying for form inputs on the Downloads tab, scope to `.settings-content` to avoid the app's global header search input (placeholder `"Search videos, channels..."`, which is easy to accidentally substring-match against a loose selector) — the Downloads tab's own channel-tracking input has the distinct placeholder `"Channel name (e.g. Marques Brownlee, Veritasium...)"`.

- [ ] **Step 3: Sweep all 6 tabs at the standard width set**

For each of the 6 tabs, at each width in **1440, 900, 600, 480, 481, 375, 340, 320** (set with `resize_window`, reloading after each resize so load-time gates re-run, then re-navigating to the target tab per Step 2), run:

```js
(() => {
  const ca = document.querySelector('.content-area');
  return {
    tab: document.querySelector('.tab-btn.active')?.textContent.trim(),
    width: window.innerWidth,
    caOverflow: ca ? ca.scrollWidth - ca.clientWidth : 'n/a',
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
})()
```

Expected: `caOverflow <= 0` and `docOverflow <= 0` at every width on every tab. Before Tasks 1-2, Downloads/Music/Podcasts read ~15px at 320px and Users reads ~109px; after them all six tabs must read `0` at every width. 481px is included specifically to confirm the new `@media (max-width: 480px)` rule in `.search-channel-card` does not leak into desktop layouts.

- [ ] **Step 4: Verify real content actually exercises the fixed elements on Downloads, Music, and Podcasts**

An empty state (no queue items, no search results) would pass Step 3 trivially without proving anything. On each of these three tabs, confirm real content is present and separately measure it:

```js
(() => {
  const grid = document.querySelector('.search-results-grid');
  const cards = document.querySelectorAll('.search-channel-card');
  const queueCards = document.querySelectorAll('.queue-card-premium');
  return {
    tab: document.querySelector('.tab-btn.active')?.textContent.trim(),
    gridPresent: !!grid,
    searchCardCount: cards.length,
    queueCardCount: queueCards.length,
    gridOverflow: grid ? grid.scrollWidth - grid.clientWidth : 'n/a'
  };
})()
```

On Downloads: trigger a real channel search first (type into the `.settings-content`-scoped "Channel name" input, e.g. "DirtyBiology", and click "Search Channel") to populate `.search-channel-card` elements, per the gotcha in Step 2. On Music: `.search-channel-card` should already be present (GIMS is a followed artist, no action needed). On Podcasts: check for existing history/queue content; if genuinely empty, note that in the report rather than silently skipping the check.

Expected: at least one `.search-channel-card` and, where the queue has real content, at least one `.queue-card-premium`, at 320px, with `.content-area` overflow still 0.

- [ ] **Step 5: Verify the Users tab's registration form and account list with real accounts**

At 320px, confirm at least 2 real accounts render in `.users-list-grid` (this dev database already has `dev-fixture-admin` and `root`), and that the role-selector cards are visible:

```js
(() => {
  const cards = document.querySelectorAll('.user-card-premium');
  const roleCards = document.querySelectorAll('.role-card');
  const ca = document.querySelector('.content-area');
  return {
    userCardCount: cards.length,
    roleCardCount: roleCards.length,
    caOverflow: ca.scrollWidth - ca.clientWidth
  };
})()
```

Expected: `userCardCount >= 2`, `roleCardCount === 2`, `caOverflow === 0`.

- [ ] **Step 6: Confirm no regression at desktop widths**

At 1280px, confirm the media-query-gated fix does not fire and the shared-class fixes remain no-ops:

```js
(() => {
  const card = document.querySelector('.search-channel-card');
  const grid = document.querySelector('.search-results-grid');
  return {
    cardFlexDirection: card ? getComputedStyle(card).flexDirection : 'n/a',
    gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : 'n/a'
  };
})()
```

Expected: `cardFlexDirection === 'row'` (not stacked), and `gridColumns` shows multiple wide tracks (e.g. two ~410px columns), not a single narrow one.

- [ ] **Step 7: Confirm no other file was touched**

Run: `cd /Users/light/Git/youkeep && git diff --stat main -- app/`

Expected: exactly one file listed — `app/pages/settings.vue`. Any other file appearing means work was done outside the audit's findings — revert it.

- [ ] **Step 8: Stop the dev server**

Stop the preview server. No commit is needed for this task.

---

## Self-Review

Run at the end of writing, against the design spec at `docs/superpowers/specs/2026-09-07-settings-responsive-audit-design.md`.

### 1. Spec coverage

| Spec requirement | Where it lands | Outcome |
|---|---|---|
| Audit all 6 tabs | Audit §1-9 + summary table | **Covered.** 9 bugs found and fixed across Downloads/Music/Podcasts/Users; Stats and System independently reconfirmed clean (not just assumed from prior fixes) |
| `.search-results-grid` candidate (design spec) | Audit §3 | **Confirmed real, largest bug found** — but needed 2 MORE co-located fixes (`.search-channel-card` stacking, `.channel-search-meta` ellipsis) beyond the grid-track fix alone, which the spec did not anticipate → Task 1 |
| `.users-list-grid` candidate (design spec) | Audit §7 | **Confirmed real** — also needed 2 MORE co-located fixes (`.role-selector-premium`, `.user-headline-col`) beyond the grid-track fix alone → Task 2 |
| "Anything not caught by a static grep" (design spec's own anticipation) | Audit §1, §2, §5, §6, §8, §9 | **Confirmed exactly as anticipated** — `.concurrency-control` (an inline style, invisible to a CSS grep), `.form-select` (a MISSING rule, invisible to a grep for existing bad values), and four ellipsis-truncation gaps were all found only by live measurement |
| Global Constraint — no password-change-flow changes | Not touched anywhere in this plan | Covered |
| Global Constraint — no `/account` changes | Not touched anywhere in this plan | Covered |
| Global Constraint — no card redesign | All fixes are CSS-value changes or new CSS-only rules; no template/structure changes in any `.vue` file | Covered |
| Global Constraint — established idioms only | `min(px,100%)` for grids, `flex-wrap:wrap` for unwrappable rows, ellipsis truncation (already used identically elsewhere in this exact file), `width:100%` (matching `.form-input`'s own established convention) — no new pattern invented | Covered |
| Global Constraint — shared-class fixes re-verified per tab | Task 3 Step 4 explicitly re-measures Downloads/Music/Podcasts independently with real content on each | Covered |
| Verification — real-browser measurement at the full width sweep | Task 3 | Covered, including a 480/481px boundary check and an explicit real-content check (Step 4) so an empty state can't trivially pass |

No gap found. Every spec section maps to a task or to a recorded audit outcome.

**A note on what this audit found beyond the design spec's own guesses**: both of the spec's named candidates turned out to be real, but neither was the FULL bug — each was one of three co-located issues in the same UI region, found only by continuing to measure after the first fix instead of stopping once one plausible cause was patched. This mirrors the previous music/podcasts sub-project's finding that a design-time static scan reliably finds the "obvious" CSS values but reliably misses inline styles, missing rules, and content-dependent shapes that only show up with real data in a real browser.

### 2. Placeholder scan

Searched for `TBD`, `TODO`, `implement later`, `fill in details`, `add appropriate error handling`, `add validation`, `handle edge cases`, `write tests for the above`, `similar to Task N`, and any step describing a change without showing it.

- Every CSS step in Tasks 1-2 shows the full before-and-after block, including the two brand-new rules (`.concurrency-control`, `.form-select`) that don't exist in the file today.
- Task 2 does not say "same fix as Task 1" without restating the full rule — the `min(300px,100%)` idiom is written out in full in both tasks' Step 3/Step 4 respectively, even though it's the same idiom.
- Task 3's browser steps show complete JS snippets and exact pass conditions, including an explicit anti-empty-state check (Step 4) rather than trusting a bare overflow-number pass.
- Task 1 Step 6 explicitly notes the insertion point (after the Step 4 edit, before `/* Custom forms integration */`) since it's a brand-new rule with no prior location to "replace."

### 3. Type and signature consistency

- Every CSS selector used in the tasks and in Task 3's snippets was confirmed to exist in the current on-disk file at the stated line numbers as of the base commit `2e76e3a`: `.queue-actions-row` (`:392`), `.search-channel-card` + `:hover` (`:1001-1015`), `.channel-search-meta` (`:1041`), `.search-results-grid` live rule (`:1518`), `.queue-card-channel-name` (`:1658`), `.role-selector-premium` (`:1847`), `.user-headline-col` + `h4` (`:1989-2000`), `.users-list-grid` (`:2051`).
- The dead, first `.search-results-grid` rule (`:992-999`) is explicitly called out as NOT to be touched, in both the Audit Results and Task 1 Step 4 — a real risk given there are two rules with the identical selector in this file.
- Line numbers for Task 2's edits are given as of the BASE commit (before Task 1 runs) — Task 1's edits land entirely before line 1518, so Task 2's target lines (1847+) will have shifted down by however many net lines Task 1 adds. Per this codebase's established plan-writing convention (seen in every prior sub-project's plan), each step gives the exact current CSS content to find and replace, which remains valid and locatable regardless of line-number drift — the line numbers are orientation, not a strict machine offset.
- Both new rules (`.concurrency-control`, `.form-select`, and `.user-headline-col .badge`) are explicitly scoped under `.settings-container` and, for the badge, further scoped to `.user-headline-col .badge` rather than the bare global `.badge` class — verified against `app/assets/css/main.css:310`, which IS used elsewhere in the app and must not be modified.
- Test command is `npm test` → `vitest run`, matching every prior sub-project in this initiative.
- The dev-login CSRF flow and the `allowedTabs`/global-search-input navigation gotchas are recorded once, in the Audit Results and again inline in Task 3, so the verification task doesn't have to rediscover them.
