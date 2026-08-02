# Automatic Resync Cron for Followed Music Artists — Design

## Context

Second of five independent YouKeep improvement items (Cache-Control headers shipped first). The video pipeline already has a working cron (`initScheduler()` in `server/utils/downloader.ts`, wired from `server/plugins/scheduler.ts`) that periodically calls `syncAllChannels()` to re-fetch every followed channel's feed and queue any new uploads. The music pipeline has no equivalent — a followed artist's catalog only refreshes when an admin manually clicks "sync" on that one artist (`server/api/admin/music/artists/[id]/sync.post.ts`).

## Scope

- A new cron job, mirroring the video one exactly in mechanism, that periodically re-ingests every followed artist's channel feed to discover new tracks.
- Its own admin-configurable enable/schedule settings, independent of the video cron's.
- A settings UI panel to control it, in the same place and style as the video cron's existing panel.

## Non-Goals

- No per-artist pause/resume toggle — none exists today for music artists (video's per-channel `sync_status='paused'` endpoint exists but `syncAllChannels()` already ignores it when the cron fires, a pre-existing quirk in the video pipeline). This work does not add or fix per-artist pause semantics for either pipeline; the new music cron mirrors video's actual current behavior (resync every followed artist unconditionally, respecting only the global pause flag).
- No change to the manual per-artist sync endpoint, the download queue worker, or track-level download logic.
- No new settings UI for feat-only artists (`channel_id IS NULL`) — they're never followed channels and are correctly excluded from resync, same as they're excluded from the manual sync endpoint (which already 400s on a null `channel_id`).

## Design

### 1. New settings

`music_sync_cron_enabled` (`'0'`/`'1'`, default `'0'`, matching the video cron's off-by-default) and `music_sync_cron_schedule` (default `'30 3 * * *'`, i.e. 3:30 AM — deliberately offset 30 minutes from the video cron's default `0 3 * * *` so both jobs don't hit `yt-dlp` concurrently if an admin enables both with their defaults).

### 2. `syncAllMusicArtists()` — `server/utils/musicDownloader.ts`

Mirrors `syncAllChannels()` in `server/utils/downloader.ts` field-for-field:
- Sets `music_downloader_paused`-respecting loop: before processing each artist, check the setting and stop early if paused (matching `syncAllChannels`'s check of `downloader_paused` before each channel).
- Sets every followed artist's (`channel_id IS NOT NULL`) `sync_status = 'downloading'`.
- Re-ingests each via `ingestMusicUrl(https://www.youtube.com/channel/{channel_id})`, one at a time, catching and logging per-artist errors without aborting the whole run (same as `syncAllChannels`'s per-channel try/catch).
- Starts the music queue worker at the end so newly-discovered pending tracks begin downloading.
- Uses the same `sync_all_active`-style reentrancy guard pattern as the video job, under its own setting key (`music_sync_all_active`), so a slow run can't overlap with itself.

### 3. `initMusicScheduler()` — `server/utils/musicDownloader.ts`

Mirrors `initScheduler()`: reads the two new settings, and if enabled, registers a `croner` `Cron` job on `music_sync_cron_schedule` that calls `syncAllMusicArtists()` (skipping if `music_sync_all_active` is already `'1'`). Uses its own module-level active-job handle (separate from the video cron's), so restarting one doesn't affect the other.

### 4. Wiring — `server/plugins/scheduler.ts`

Add `initMusicScheduler()` alongside the existing `initScheduler()` call at startup — this file already imports from `musicDownloader.ts` for the stale-download reset and queue-worker start, so this is a one-line addition to an existing import and an existing call site.

### 5. Admin endpoints

`GET /api/admin/music/schedule` and `POST /api/admin/music/schedule`, mirroring `server/api/admin/downloader/schedule.{get,post}.ts` exactly: the GET returns `{ enabled, schedule }`; the POST validates the cron expression with a throwaway `new Cron(schedule)` call (rejecting with 400 on invalid syntax), persists both settings, and calls `initMusicScheduler()` to restart the job with the new configuration.

### 6. Settings UI

Inside the existing Music tab's "Music Ingestion" panel (`app/pages/settings.vue`), add a scheduling form below the existing pause/resume + concurrency row — same structure as the video Downloads tab's scheduling form: a checkbox to enable, a preset dropdown (Hourly / Every 12 hours / Daily at 3:30 AM / Weekly / Custom), and a custom cron-expression text input shown only when "Custom" is selected. Wired to the new endpoints from §5, following the exact same `scheduleForm`/`applyPreset`/`fetchSchedule`/`handleSaveSchedule` pattern already implemented for video, duplicated under music-specific names rather than parameterized — this file doesn't currently share form logic between its video and music panels, and introducing a shared abstraction for one duplicated form isn't warranted by this scope.

## Error Handling

- An artist whose `ingestMusicUrl` call fails (network error, yt-dlp failure, channel deleted) is logged and skipped; the run continues with the next artist — never aborts the whole cron run for one bad artist.
- If `music_downloader_paused` is set mid-run, the loop stops before starting the next artist (already-started ingestion for the current artist still completes, matching video's identical mid-loop pause check).
- An invalid cron expression submitted via the settings UI is rejected with a 400 before anything is persisted — the previous valid schedule (if any) stays active.

## Verification

- Endpoint tests: `GET`/`POST /api/admin/music/schedule` (admin-only, cron-expression validation, persists and restarts the scheduler).
- `syncAllMusicArtists()`: unit-testable for its per-artist loop behavior (skips feat-only artists, respects the pause flag, continues past a per-artist ingestion failure) by mocking `ingestMusicUrl`.
- Manual: enable the music cron with a short custom interval (e.g. `* * * * *`), confirm a followed artist's new tracks appear as `pending` and get downloaded without manual intervention, confirm the video cron's own schedule is unaffected by toggling the music one.
