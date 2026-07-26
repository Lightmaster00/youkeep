# Music Ingestion from YouTube — Design

## Context

Second sub-project of the "Music mode" initiative (see project memory `project_music_mode` for the full ordered plan). Sub-project 1 (`docs/superpowers/specs/2026-07-22-music-data-model-design.md`, commit `13d196b`) created four tables — `music_artists`, `music_albums`, `music_tracks`, `music_track_artists` — currently unused. This sub-project builds the pipeline that populates them: following a YouTube channel/video as music, downloading audio, and parsing what metadata is available.

The existing video downloader (`server/utils/downloader.ts`) has a mature, working pattern for exactly this shape of problem: `ingestUrl` (channel-vs-single-video detection, metadata upsert), `downloadVideoFile` (yt-dlp invocation, progress tracking, watchdog timeout), and the concurrent queue worker built in the previous sub-project (`docs/superpowers/specs/2026-07-22-concurrent-downloads-design.md`). This design mirrors that pattern rather than reinventing it, adapted for audio-only extraction and the music schema.

## Scope

The backend pipeline only: a new `server/utils/musicDownloader.ts` module (ingestion, download, queue worker) plus admin API endpoints to trigger it. Explicitly excludes any UI.

## Non-Goals

- No UI changes of any kind — not even adding a "Video/Music" selector to the existing admin ingest form. That belongs to sub-project 3, which will wire these endpoints up. Verification here is via direct DB inspection and `curl`, the same approach used to verify sub-project 1.
- No GET/listing endpoints (e.g. "list all artists") — those exist to serve a UI that isn't built yet; adding them now would be speculative.
- No automatic feat-artist detection or metadata guessing from titles/descriptions. If yt-dlp doesn't expose a field (album, genre, track_number), the column stays `NULL`. Manual editing is future UI work.
- No per-channel/per-artist custom save path (mirroring `channels.custom_save_path`) — one fixed music download directory for now, consistent with `music_artists` not having that column (a sub-project-1 decision already made).
- No re-encoding — audio is extracted in whatever container/codec YouTube served (typically m4a or opus), never transcoded to MP3 or anything else, per the existing corrected-misconception note in `project_downloader_feature_wishlist` (re-encoding an already-lossy source recovers no quality).

## Design

### 1. Ingestion: `ingestMusicUrl(url, options)`

Mirrors `ingestUrl` (`server/utils/downloader.ts:962`) structurally:

- Same channel-URL-pattern detection (`/youtube\.com\/(channel\/...|@...|c\/...|user\/...)\/?$/`) to distinguish "follow this whole channel" from "single video."
- **Channel case:** look up `music_artists` by `channel_id` (not by primary key, since `music_artists.id` is a generated id, not the YouTube channel id — a sub-project-1 decision). If found, update mutable fields (name, avatar, banner); if not, insert a new row with a generated id, the channel id, `sync_status` and `visibility` from `options` (same defaulting as `ingestUrl`: `sync_status` defaults to `'paused'`, `visibility` to `'public'`). Then flat-scan the channel's uploads (same `--flat-playlist` yt-dlp approach as `ingestUrl`) and upsert one `music_tracks` row per entry, `download_status = 'pending'`, `artist_id` = this artist's generated id.
- **Single-video case:** resolve (or create, same lookup-by-`channel_id` logic) the artist from the video's channel, then upsert one `music_tracks` row for that video.
- Whether newly-added tracks are queued immediately mirrors the existing behavior: only if the artist's `sync_status` is already `'downloading'` at insert time does this call `startMusicQueueWorker()`.

### 2. Download: `downloadMusicTrackFile(trackId, artistId)`

Mirrors `downloadVideoFile` (`server/utils/downloader.ts:605`):

- yt-dlp invocation: `-x` (extract audio), best available native audio stream, no format conversion — no `--merge-output-format`/`--convert-thumbnails`-style transcoding flags. `--write-thumbnail`, `--write-info-json` (read then deleted after parsing, same as video), same watchdog timeout pattern (`DOWNLOAD_TIMEOUT_MS`), same progress/speed/ETA parsing off yt-dlp's stdout, updating `music_tracks.download_progress`/`download_speed`/`download_eta` as it runs.
- Output path: `data/downloads-music/{sanitized artist name}/{trackId}.%(ext)s` — a new sibling directory to `data/downloads/` (or the configured `default_downloads_dir`'s sibling), not nested inside it. Reuses the existing `sanitizeFolderName` helper (`server/utils/downloader.ts:10`) unchanged.
- After download, parse the info JSON for `album`, `genre`, `track_number` (exact yt-dlp field names to be confirmed empirically against a real download during implementation — not asserted as fact here, same honesty standard applied to the SponsorBlock chapter-title-prefix format in the earlier chapters/SponsorBlock spec). Any field yt-dlp doesn't expose is left `NULL` on the `music_tracks` row — no fallback parsing of the title/description.
- **Album linking:** if an `album` name was found, look for an existing `music_albums` row for this artist with that exact title (regardless of its `source`). If found, link the track to it. If not found, create a new one with `source = 'youtube'` and link to that. A `source = 'manual'` album is therefore never overwritten by ingestion — only ever matched-and-reused by title, never mutated.
- **Credit row:** always insert exactly one `music_track_artists` row — `(track_id, artist_id, role = 'primary')` — once per track, at the same point `downloadVideoFile`'s success path marks a video `completed`. Never more than one row, never a `'feat'` row, per the Non-Goals.
- Success/failure DB updates mirror `runSingleDownload`'s logic in `server/utils/downloader.ts` exactly: on success, `download_status = 'completed'`; on failure, distinguish intentional pause/cancel (revert to `pending`, keep progress) from a real error (revert to `pending`, reset progress, bump `created_at`, record `last_error`).

### 3. Queue worker: `startMusicQueueWorker()`

A second, independent orchestrator loop, structurally identical to the one built in the concurrent-downloads sub-project — same shape (dedicated active-count symbol, no-`await`-between-claim-and-launch correctness property, fire-and-forget per-track task) — but polling `music_tracks`/`music_artists` instead of `videos`/`channels`, and gated by its own settings:

- `music_downloader_paused` (default `'0'`) — independent of `downloader_paused`.
- `music_max_concurrent_downloads` (default `'2'`) — independent of `max_concurrent_downloads`.

Reuses `parseMaxConcurrentDownloads`/`hasCapacityForMoreDownloads`/`isValidMaxConcurrentValue` from `server/utils/concurrency.ts` as-is — that module is already generic (no video-specific naming or logic), so no duplication needed there. Only the orchestrator loop itself, its own `activeMusicDownloadCount` counter, and its own settings keys are new.

### 4. Admin API endpoints

Mirroring the existing video endpoints one-for-one, under `server/api/admin/music/`:

- `POST /api/admin/music/ingest` — body `{ url, sync_status?, visibility? }`, calls `ingestMusicUrl`. Mirrors `server/api/admin/downloader/ingest.post.ts`.
- `POST /api/admin/music/pause` / `POST /api/admin/music/resume` — mirror `pause.post.ts`/`resume.post.ts`, acting on `music_downloader_paused` and (for pause) cancelling any in-flight music downloads back to `pending`.
- `POST /api/admin/music/artists/[id]/sync` — mirrors `channels/[id]/sync.post.ts`: sets that artist's `sync_status = 'downloading'` and triggers a background re-ingest.
- `POST /api/admin/music/tracks/[id]/cancel` — mirrors `downloader/cancel.post.ts`.

All admin-gated (`requireAdmin`), same as every existing endpoint under `server/api/admin/`.

## Error Handling

- A channel can be followed as both a video channel and a music artist simultaneously with no conflict — `channels` and `music_artists` are fully independent tables with independently-generated/looked-up ids.
- Re-ingesting an already-followed artist is idempotent (upsert by `channel_id`), same as `ingestUrl`'s channel upsert today.
- A track download failing mid-flight uses the exact same three-way distinction (paused/cancelled vs. real error vs. success) as the video pipeline — no new failure modes introduced.
- If yt-dlp's info JSON doesn't include `album`/`genre`/`track_number` at all (common for uploads without YouTube Music-style Content ID tagging), the track downloads successfully and simply has those columns `NULL` — not treated as an error.

## Verification

- Follow a real music-oriented YouTube channel → confirm a `music_artists` row is created, at least one `music_tracks` row reaches `download_status = 'completed'`, and the audio file exists on disk under `data/downloads-music/`.
- A track whose yt-dlp metadata includes an album name → confirm a `music_albums` row is created/linked with `source = 'youtube'`.
- A track with no such metadata → confirm `album_id IS NULL` and no error.
- For every completed track, confirm exactly one `music_track_artists` row exists with `role = 'primary'` — never zero, never more than one, never `'feat'`.
- Set `music_max_concurrent_downloads` to 2+, queue several tracks → confirm multiple simultaneous `downloading` rows in `music_tracks`, independent of whatever the video worker is doing at the same time.
- Pause music (`POST /api/admin/music/pause`) while the video worker is actively downloading → confirm only music downloads stop; video downloads are unaffected.
