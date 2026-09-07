# Settings Responsive Audit — Design

**Status:** Approved
**Sub-project:** 4 of the app-wide responsive initiative (see `project_app_responsive_initiative.md` memory). Sub-projects 1-3 (single active mini-player, catalog pages audit, music/podcasts catalog audit) are done and merged, plus every follow-up bug found along the way — two of which were already in `settings.vue` itself (`.metrics-grid`, `.banner-quick-stats` on the Stats tab).

## Goal

Audit the Settings page — its shared layout/tab-bar chrome and all 6 tabs — for real responsive overflow bugs at narrow viewport widths, and fix whatever is confirmed. Not a speculative rebuild, and not limited to the bugs already found by a static scan during brainstorming.

## Scope

**In scope:**
- `app/pages/settings.vue` — the page shell (tab sidebar, tab content area) and, since it is the ONLY file in this app area carrying any CSS at all (see Architecture below), every style rule for all 6 tabs.
- All 6 tab components: `app/components/settings/SettingsStatsTab.vue`, `SettingsDownloadsTab.vue`, `SettingsMusicTab.vue`, `SettingsPodcastsTab.vue`, `SettingsUsersTab.vue`, `SettingsSystemTab.vue`.

**Out of scope:**
- The password-change-required flow (`currentUser?.mustChangePassword`), which hides the tab sidebar entirely — this is an edge-case auth flow, not a catalog/content page, and out of this initiative's stated areas.
- Any full mobile-layout redesign — this sub-project fixes overflow, not layout philosophy. The page shell already has reasonable responsive coverage (see Architecture) that this sub-project builds on, not replaces.
- `/account` (the non-admin settings-equivalent page, per `settings.vue`'s own `navigateTo('/account')` redirect for non-admins) — a different file, different page, not part of "Settings" as scoped here.

## Architecture

Unlike every prior page audited in this initiative, none of the 6 tab components carry their own `<style>` block — all CSS for the entire Settings page and all 6 tabs lives in one place: `app/pages/settings.vue`'s single, unscoped `<style>` block (roughly 1900 lines). This means the audit and every fix in this sub-project touch exactly one file's stylesheet, even though the bugs themselves live inside child-component templates — the same "component has no style block, its styling lives in the parent page" shape this initiative has seen before (`ChannelVideoGrid.vue`/`channels.vue` in sub-project 2).

The page shell already has established, working responsive coverage worth preserving, not rebuilding: `.settings-layout` is a `grid-template-columns: var(--sidebar-width) 1fr` that collapses to a single column at `max-width: 900px`, and `.settings-tabs` switches from a vertical column to a horizontal `overflow-x: auto` scrolling strip at the same breakpoint — the same `overflow-x: auto` idiom already established elsewhere in this app.

## Approach

Same method used in sub-projects 2 and 3:

1. **Genuine audit, not a transcription of design-time guesses.** The design phase's static grep already found two confirmed candidates (`.search-results-grid` and `.users-list-grid`, both `minmax(300px, 1fr)` — larger than any value fixed so far in this initiative), but a static grep is not exhaustive: sub-project 3 found that some of this bug class depends on real rendered content (button widths, long text) that only shows up in a live browser. The implementation plan's audit step must independently verify every candidate against the real rendered page — including checking for bugs the static scan didn't and couldn't catch (download-queue rows, user-list rows, ingestion-form layouts) — before any fix is written.
2. **Fix using the already-established idioms** for this bug class:
   - Grid track minimum: wrap a fixed `minmax(<px>, 1fr)` as `minmax(min(<px>px, 100%), 1fr)`.
   - Fixed-width flex item: pair `max-width: 100%` with `min-width: 0` on the flex item and any child whose intrinsic content width would otherwise floor it.
   - Unwrappable horizontal row of items: `overflow-x: auto`, matching this app's `.channel-tabs-bar`/`.channels-row`/`.playlists-row`/`.settings-tabs` convention.
3. **Verify with real browser measurement**, not CSS reading alone — width sweep from 320px up (at minimum 320/375/414/480/600/900px), on every one of the 6 tabs, since a single shared stylesheet means a fix to one class (e.g. `.search-results-grid`) can affect multiple tabs at once and each tab needs its own confirmation that it actually renders content to exercise the fixed CSS.

## Candidate risk areas (to confirm or refute during the audit, not pre-committed fixes)

- **`.search-results-grid`** (`settings.vue:1520`, `minmax(300px, 1fr)`): shared by `SettingsDownloadsTab.vue`, `SettingsMusicTab.vue`, and `SettingsPodcastsTab.vue` (each tab's ingestion search-results grid). 300px is larger than the 295px value already confirmed to overflow in sub-project 2 — high suspicion this is a real, likely wide-radius bug affecting three tabs from a single rule.
- **`.users-list-grid`** (`settings.vue:2053`, `minmax(300px, 1fr)`): the Users tab's user-list grid. Same value, same suspicion.
- **Anything not caught by a static grep**: the design-phase scan found no fixed-width flex items (no `min-width` floor over 100px anywhere in the stylesheet, unlike the `.music-search-input`/`.podcast-search-input` bug from sub-project 3) and no `<table>` elements. But the scan cannot see content-dependent overflow — the shape sub-project 3 found in the artist/show detail headers and the track/episode rows, where real text (long usernames, long download filenames, long queue item titles) or several `flex-shrink: 0` siblings (action buttons, status badges, download-progress indicators) combine to exceed the content box even though no single CSS value looks obviously wrong. The Downloads, Music, Podcasts, and Users tabs all render list/row layouts with a title plus several action controls — the same general shape that caused the track-row and episode-row bugs — and must be audited live with real queue/list data, not assumed clean from the CSS alone.

## Non-goals

- No changes to the password-change-required flow.
- No changes to `/account`.
- No introduction of a card-based mobile layout for any list/row content — only overflow fixes within the existing layouts.
- No new automated tests — this bug class (CSS overflow) has no automated test coverage anywhere in this codebase; verification is real-browser measurement, matching every prior fix in this initiative.

## Verification

For each of the 6 tabs, using real data where the tab has any (existing downloads/queue items, archived music artists, archived podcast shows, real user accounts):
- Real-browser width sweep: 320, 375, 414, 480, 600, 900px.
- `scrollWidth - clientWidth` on the outer content container and on any candidate grid/row/list element, before and after any fix, at every swept width.
- Confirm no regression at desktop widths (≥1024px) for any element touched.
- If a candidate risk area turns out already safe, record the measurement showing so, rather than silently skipping it.
- Since `.search-results-grid` is shared by three tabs, a fix to it must be re-verified independently on all three (Downloads, Music, Podcasts) — a fix confirmed on one tab is not evidence it works on the others if their surrounding layout differs.
