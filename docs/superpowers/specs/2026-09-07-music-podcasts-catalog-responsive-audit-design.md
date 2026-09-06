# Music/Podcasts Catalog Responsive Audit — Design

**Status:** Approved
**Sub-project:** 3 of the app-wide responsive initiative (see `project_app_responsive_initiative.md` memory). Sub-project 1 (single active mini-player) and sub-project 2 (catalog pages responsive audit — video/shorts/channels/subscriptions/playlists) are done and merged.

## Goal

Audit the Music and Podcasts catalog pages, and their episode/track/album edit modals, for real responsive overflow bugs at narrow viewport widths, and fix whatever is confirmed — not a speculative rebuild, and not limited to the bugs guessed at design time.

## Scope

**In scope:**
- `app/pages/music/index.vue` — grid view (artist cards, automatic playlists row, filters bar) and detail view (artist header, album groups, track rows).
- `app/pages/podcasts/index.vue` — grid view (show cards, search bar) and detail view (show header, episode list).
- `app/components/MusicTrackEditModal.vue`
- `app/components/MusicAlbumEditModal.vue`
- `app/components/PodcastEpisodeEditModal.vue`

**Out of scope:**
- `app/components/BaseModal.vue` — shared modal shell with no page-specific scoped CSS, already used across the app without a known responsive issue; changing it is a different, much larger blast radius than this sub-project's target.
- `app/components/settings/SettingsMusicTab.vue` / `SettingsPodcastsTab.vue` — Settings is a separate, not-yet-scoped area of the responsive initiative.
- Any full mobile-layout redesign (e.g. converting the track/episode row layout into a card layout at narrow widths). This sub-project fixes overflow, not layout philosophy.

## Approach

Same method established in sub-project 2 (catalog-pages-responsive-audit):

1. **Genuine audit, not a transcription of design-time guesses.** The design phase flagged candidate risk areas (below) from a static read of the code, but the implementation plan's audit step must independently verify each candidate against the real rendered page — including checking for bugs the design phase didn't spot — before any fix is written. A candidate that turns out to be a false alarm (already safe at 320px) gets documented as such, not fixed.
2. **Fix using the already-established idioms** for this bug class:
   - Grid track minimum: wrap a fixed `minmax(<px>, 1fr)` as `minmax(min(<px>px, 100%), 1fr)`.
   - Fixed-width flex item: pair `max-width: 100%` with `min-width: 0` on both the flex item and any child input/text element whose intrinsic width would otherwise floor the flex item's automatic minimum size.
   - Unwrappable horizontal row of items: `overflow-x: auto`, matching `subscriptions.vue`'s `.channels-row` / `channels.vue`'s `.channel-tabs-bar` convention.
3. **Verify with real browser measurement**, not CSS reading alone — width sweep from 320px up (at minimum 320/375/414/480/600/900px), before/after `scrollWidth - clientWidth` on the affected container, at both the grid view and the detail view of each page, and with the 3 modals open.

## Candidate risk areas (to confirm or refute during the audit, not pre-committed fixes)

- **`.artist-grid` (music/index.vue) / `.show-grid` (podcasts/index.vue)**: `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`. Same bug class as `channels.vue`'s `.channel-grid` (fixed at `minmax(min(295px,100%),1fr)`) and `subscriptions.vue`'s `.video-grid` (fixed at `minmax(min(280px,100%),1fr)`), but 220px is smaller than either of those already-fixed values — plausible this is already safe at 320px and needs no fix. Confirm by real measurement, don't assume either way.
- **`.music-filters-bar`** (search input `flex:1; min-width:200px` + 3 `<select>` elements each `min-width:150px`, inside a `flex-wrap: wrap` container): the existing wrap behavior likely prevents overflow, but the combined min-widths (650px before wrapping kicks in) haven't been measured against real narrow viewports.
- **`.podcast-filters-bar`**: single search input, `flex:1; min-width:200px` — structurally simpler than the music filters bar, lower risk, still to be measured.
- **Artist/show detail headers** (`.artist-detail-header`, `.show-detail-header`): flex row with a fixed-size avatar/cover (96px / 140px, `flex-shrink:0`) and an info column with no explicit `min-width:0`. Title rows already have `flex-wrap: wrap` inline; descriptions use `max-width` (not a fixed width), which doesn't itself cause overflow. Low suspicion, but part of the audit.
- **`.track-row` / `.episode-row`**: `.track-title { flex: 1 }` has no explicit `min-width: 0` (unlike `.episode-main`, which already has `min-width: 0`). Whether this matters depends on whether real track titles contain long unbreakable strings (URLs, no-space text) — the audit should check with real data, not just short titles.
- **The 3 edit modals**: no fixed-width elements identified in the templates (global `form-input`/`form-group` classes, no inline fixed widths). Expected to be clean, but included in the verification sweep since they weren't checked in a prior sub-project.

## Non-goals

- No changes to `BaseModal.vue`.
- No changes to Settings pages.
- No introduction of a card-based mobile layout for track/episode rows — only overflow fixes within the existing list-row layout.
- No new automated tests — this bug class (CSS overflow) has no automated test coverage anywhere in the codebase to date; verification is real-browser measurement, matching every prior fix in this initiative.

## Verification

For each page (grid view + detail view, using a show/artist with enough albums/tracks/episodes to exercise the list layout) and each of the 3 modals:
- Real-browser width sweep: 320, 375, 414, 480, 600, 900px.
- `scrollWidth - clientWidth` on the outer content container, before and after any fix, at every swept width.
- Confirm no regression at desktop widths (≥1024px) for any element touched.
- If a candidate risk area turns out already safe, record the measurement showing so, rather than silently skipping it.
