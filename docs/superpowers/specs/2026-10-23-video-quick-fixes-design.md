# Video quick fixes (phase 1 of the video-side overhaul) — Design

**Status:** Approved in chat (2026-10-23). The user's full video-side request has 5 phases: (1) quick fixes [this spec], (2) new Home + Subscriptions + better recommendations, (3) channel categories, (4) languages (9 UI languages + per-user video-title language), (5) a bolder logo. Phases 2–5 get their own specs.

## Findings that drive this phase
- Auto-sync never ran: `server/utils/db.ts:~679` seeds `sync_cron_enabled = '0'` (and the music/podcast equivalents) on creation, so no scheduled sync exists unless an admin turned it on. The user's newest video is from 7 October.
- `GET /api/playlists/personal` → "401 Unauthorized. Please log in.": the session expired (24 h idle timeout when "Keep me signed in" is off) and pages keep calling the API instead of sending the user to /login.

## 1. Automatic synchronisation
- New installs AND existing installs (one-time migration guarded by a settings flag `auto_sync_default_v1`): enable the three schedules (`sync_cron_enabled`, `music_sync_cron_enabled`, `podcast_sync_cron_enabled`) with defaults `0 */6 * * *` (videos), `30 */6 * * *` (music), `45 */6 * * *` (podcasts) UNLESS the admin already stored a custom schedule value different from the default (then only the enabled flag is turned on). A later manual "disable" persists (the flag prevents re-enabling).
- Catch-up on startup: if the last completed sync of a type is older than the schedule interval (min 6 h) or missing, start a sync-all shortly after boot (60 s delay, background, respects the module flags and the paused sources, never during shutdown). Store `last_sync_at` per type in `settings` (`video_last_sync_at`, `music_last_sync_at`, `podcast_last_sync_at`, epoch ms) when a sync-all run finishes (success or partial) and also when a scheduled run starts (`*_last_sync_started_at`).
- Visibility: Settings → Downloads (and Overview card) shows per type "Last sync: <relative time> · Next: <relative time or Off>", plus the existing "Sync now". A red notice appears when a type has not synced for more than 2× its interval while enabled ("Automatic sync looks stuck — last sync 3 days ago"). Server route: extend `GET /api/admin/downloader/active-counts` or add `GET /api/admin/sync-status` → `{ video: {enabled, schedule, lastSyncAt, nextRunAt}, music: {...}, podcast: {...} }` (admin, session or token read).
- Tests: migration idempotent + respects the flag + custom schedule kept; catch-up triggers once when stale and not when fresh; status route; stuck notice logic (pure helper).

## 2. Expired sessions never show raw 401 errors
- A client-side handler (in the existing window.fetch patch / a small composable) detects a 401 on same-origin `/api/**` responses (except `/api/auth/login`, `/api/auth/setup`, `/api/auth/me`, and requests made while the user is already a guest on a public page): it clears the auth state once (debounced), shows one toast "Your session expired. Please log in again.", and navigates to `/login?redirect=<current relative path>` (validated by the existing safeRedirect). No repeated toasts, no loops.
- Pages that need a login must not call user-only APIs for guests (`/playlists`, Save-to-playlist modal, history, subscriptions): guard with the auth state (they already require login via the middleware; verify each call site).
- Make the idle expiry less surprising: login page keeps "Keep me signed in", but it is checked by default (a personal self-hosted app); security is unchanged for those who untick it.
- Tests: 401 → one toast + redirect with the original path; no handling on login/setup/me; guests on public pages unaffected; the "remember" checkbox default.

## 3. Thumbnails and previews are framed correctly
- One shared media-frame rule for every video surface (cards, hero, lists, related, playlists, search, subscriptions, history, channel grids, watch-page sidebar, hover previews): a fixed aspect-ratio box (16:9 for videos, 9:16 for Shorts, 1:1 for music/podcast), `object-fit: cover`, `object-position: center` (top-center for Shorts if needed), `overflow: hidden`, a neutral placeholder while loading, `width/height` attributes to avoid layout shift. YouTube 4:3 letterboxed thumbnails (480×360 with black bars) end up exactly 16:9 under `cover`, which removes the bars.
- The fallback remote thumbnail `https://i.ytimg.com/vi/<id>/hqdefault.jpg` (4:3 with bars) is replaced by `mqdefault.jpg` (16:9) when no local thumbnail exists.
- Hover previews (video preview on cards) use the same frame, never overflow the card, keep the poster until the first frame plays, and fall back to the thumbnail on error.
- Tests: component tests that each card type renders the frame class and aspect ratio; the thumb URL helper picks mqdefault; a style test is not needed beyond class presence.

## 4. Shorts are separate from long videos
- Everywhere a list of videos is shown, long-form lists exclude Shorts by default (server `is_short = 0`), and Shorts appear in a clearly separate place: a "Shorts" shelf/tab. Where a list legitimately mixes both (search results, channel page "All", playlists, history, subscriptions), each Short card is visibly different: vertical 9:16 frame, a "SHORT" badge, and results are grouped into two sections ("Videos" then "Shorts") with a header, never interleaved.
- Inventory every surface (agent task): `/api/videos` callers, `/api/home/feed` sections, recommendations (`server/utils/recommend.ts`), related videos on the watch page, search page, channel page tabs (add "Shorts" tab beside "Videos"), subscriptions, playlists, history. Fix each; add an explicit `type=video|short|all` query parameter (`is_short` stays for backward compatibility) validated by the server.
- Tests: server returns no Shorts for default lists; `type=short` returns only Shorts; each UI surface renders the badge/section; the home feed never contains Shorts in video rows.

## 5. Remove "Recently added" from the video side
- Remove the home section id `recent` (label "Recently added") from `shared/displayPrefs.ts` (`HomeSectionId`, `HOME_SECTION_IDS`, `GUEST_HOME_SECTIONS`, defaults, labels), the home feed builder, the Display preferences form and the home page. Stored preferences that still list `recent` are cleaned (parse tolerates and drops it; the stored value is rewritten on next save). Guests' default home sections keep working (popular, etc.). Home must not become empty: until phase 2 replaces it, the default list is `['popular','suggested','subscriptions']` and guests get `['popular']`.
- Music/podcast "recent" rows and pages are NOT touched.
- Tests: prefs parsing drops `recent`; feed has no `recent` section; form lists no such option; empty-home states still work.

## Out of scope for this phase
New home layout, subscriptions redesign, recommendation algorithm, categories, languages, logo.
