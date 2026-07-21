# Selective Channel Playlist Download — Design

## Context

Second sub-project out of the downloader feature wishlist (see project memory `project_downloader_feature_wishlist`), after chapters/SponsorBlock (`docs/superpowers/specs/2026-07-21-chapters-sponsorblock-design.md`).

The wishlist originally described this as "YouTube playlist download" and assumed the existing `personal_playlists`/`personal_playlist_videos` tables could be reused for it. That assumption was wrong: those tables back an unrelated in-app feature (a user manually grouping already-archived videos into their own named playlist), not YouTube-sourced playlist data. The actually-relevant existing tables are `playlists`/`playlist_videos`, which store YouTube playlists that belong to a channel already in the archive (`channel_id NOT NULL`), and are populated by `syncChannelPlaylists()` in `server/utils/downloader.ts:1573`. Today that function only *links* videos that are already archived into a playlist grouping — it never triggers a new download, and it only inserts a playlist row at all if it already found at least one archived video in it.

Separately, `ingestUrl()` (`server/utils/downloader.ts:962`) treats any URL whose yt-dlp output has `entries` — including an arbitrary playlist URL — as a "channel", creating a synthetic channel row keyed off the playlist and misattributing every video in it to that fake channel. This is a real latent bug if a playlist URL is ever pasted into the existing "Add channel/URL" admin form, but fixing generic/multi-channel playlist ingestion is out of scope here (see Non-Goals).

## Scope

Let an admin selectively download specific playlists that belong to a channel already tracked in the archive, independent of that channel's own video/shorts sync settings — e.g. a channel with sync paused, where only one specific playlist ("Let's Play Zelda") should be downloaded and kept up to date.

## Non-Goals

- Arbitrary/mixed playlists spanning multiple channels, or playlists from a channel not already in the archive. (The `ingestUrl` misattribution bug this would otherwise require fixing is left alone.)
- Per-video content-type filtering (shorts/lives/date) within a followed playlist — a followed playlist downloads everything in it.
- Removing already-downloaded video files when a playlist is unfollowed, when a video disappears from the source playlist, or when the playlist itself is deleted/goes private upstream. The archive never deletes on its own here.
- A dedicated cron/schedule just for playlists — reuses the existing per-channel resync cadence (manual "Sync Playlists", per-channel "Sync Now", and the periodic "sync all" job).

## Design

### 1. Data model

Add one column to the existing `playlists` table (migration, same pattern as the other `ALTER TABLE ... ADD COLUMN` lines in `server/utils/db.ts:195-217`):

```sql
ALTER TABLE playlists ADD COLUMN download_enabled INTEGER DEFAULT 0;
```

A playlist with `download_enabled = 1` is "followed"; its videos are downloaded and it's kept in sync on future resyncs. Default `0` means no behavior change for any existing instance.

### 2. Playlist discovery (relaxing the current gate)

`syncChannelPlaylists()` currently only calls `insertPlaylist.run(...)` when `completedEntries.length > 0` (i.e., it only surfaces a playlist once something in it is already archived — a chicken-and-egg problem for a "browse and opt in" flow). Remove that gate: every public playlist found on the channel's `/playlists` tab is upserted into the `playlists` table on every scan, regardless of whether any of its videos are archived yet. This makes empty-so-far playlists visible in the UI so the admin can follow them.

### 3. Following a playlist (immediate effect)

New endpoint: `POST /api/admin/channels/[id]/playlists/[playlistId]/toggle`, admin-only, body `{ enabled: boolean }`. Behavior:

- 404 if the channel or playlist doesn't exist.
- Sets `playlists.download_enabled` for that row.
- If turning it **on**: immediately re-fetches that one playlist's entries (`--dump-single-json --flat-playlist` on `https://www.youtube.com/playlist?list=<id>`, the same call `syncChannelPlaylists` already makes per-playlist) and upserts every entry into `videos` — `channel_id` set to the parent channel's id (see §5), `download_status = 'pending'` for new rows, existing rows left alone via the same `ON CONFLICT DO UPDATE` metadata-refresh pattern `ingestUrl` already uses (`server/utils/downloader.ts:1198-1207`) — then calls `startQueueWorker()`. This gives immediate download start rather than waiting for the channel's next scheduled resync.
- If turning it **off**: just flips the flag. No queue changes, no file deletion, no `playlist_videos` cleanup.

### 4. Staying in sync (reusing the existing resync path)

`syncChannelPlaylists()` gains one change: for each playlist in the scan where `download_enabled = 1` (checked against the row already in DB before it's overwritten this pass), also upsert its current entries into `videos` the same way §3 does for the immediate-follow case, before doing the existing `clearPlaylistVideos` + re-link-completed-videos step. This function is already invoked automatically after every channel re-ingestion — manual per-channel "Sync Playlists", per-channel "Sync Now", and the periodic "sync all" cron (`syncAllChannels`, which re-ingests every channel each run regardless of individual pause state) — so a followed playlist keeps picking up newly-added videos on the same cadence, with no new scheduling mechanism and independent of the parent channel's own `sync_status`.

The existing `clearPlaylistVideos` + re-insert-only-completed step is unchanged and still runs after the upsert — so `playlist_videos` (the *grouping* link used for playlist display) still only shows videos that have finished downloading, exactly as it displays today; only the *queueing* behavior is new.

### 5. Attribution and field handling

Every entry in a followed playlist is attributed to the parent channel (`channel_id` = the channel this playlist belongs to) — no attempt to read a per-entry uploader from the flat-playlist output, since that's unreliable in `--flat-playlist` mode and out of scope per the Non-Goals (channel-owned playlists only). A followed playlist ignores the parent channel's `download_videos`/`download_shorts`/`date_after` settings entirely — those gate the channel's own Videos/Shorts tabs, not an explicitly-followed playlist. Missing fields (duration, view_count, upload_date — commonly absent in flat-playlist output) are tolerated the same way `ingestUrl`'s existing video upsert already tolerates them (`COALESCE` against existing values, `Video ${id}` title fallback); the real metadata gets filled in properly once the video is actually downloaded.

### 6. Settings UI

In the existing "Playlists" tab on the channel detail page (`app/pages/channels.vue:409`), each playlist card gets a follow toggle and a state label ("Suivie" / "Non suivie"). Toggling calls the new endpoint and updates the card's label; no other UI changes to the tab.

## Error Handling

- Per-playlist fetch failures during a scan (playlist gone private/deleted) are already caught individually in `syncChannelPlaylists`'s per-playlist loop — this continues to log and skip that playlist without affecting others. `download_enabled` and the existing DB row are left untouched; no automatic unfollow.
- The toggle endpoint's immediate-fetch-on-follow-on can fail (network/yt-dlp error) — in that case return an error to the admin but still leave `download_enabled = 1` set, so the next scheduled resync will retry rather than the follow silently doing nothing forever.

## Verification

- Follow a playlist on a channel whose own sync is paused → that playlist's videos move to `pending` and download; the rest of the channel's videos are untouched.
- Add a new video to that playlist on YouTube → it's picked up on the next resync (manual "Sync Playlists" or the periodic "sync all" job) without further admin action.
- Unfollow a playlist → no new videos are picked up on the next resync; previously downloaded videos remain in the archive and stay linked in `playlist_videos`.
- A playlist with zero archived videos now appears in the channel's Playlists tab (previously required ≥1 already-archived video to show up at all).
- A followed playlist that goes private mid-tracking → the resync logs an error for that one playlist and continues processing the channel's other playlists without crashing.
