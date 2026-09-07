# Wipe All Libraries — Design

**Status:** Approved

## Goal

Give an admin a single, heavily-guarded action that permanently deletes all archived content (videos, music, podcasts) — both the database rows and the downloaded files on disk — across every channel, artist, and show. This is the most destructive action in the app and the design centers on making that hard to trigger by accident and easy to understand once triggered.

## Context

Investigated before this design (see the brainstorming conversation for full detail):

- **Video** already has full delete support: a per-video delete route (`server/api/admin/videos/[id].delete.ts`) and a per-channel delete route (`server/api/admin/channels/[id].delete.ts`) that cancels in-flight downloads, `fs.rmSync`s the channel's directory (respecting a per-channel `custom_save_path` override), and deletes the DB row — cascading via `ON DELETE CASCADE` to every FK-linked table (videos, subtitles, playlist entries, subscriptions, etc.).
- **Music and podcasts have no delete support at all today** — not for a single track/episode, and not for a whole artist/show. This project must build that delete logic from scratch, following the exact same shape as the existing channel-delete (cancel active downloads → remove the artist's/show's directory → delete the DB row, letting cascades handle the rest), before the wipe-all action can use it.
- Every video/track/episode belongs to exactly one channel/artist/show (`channel_id`, `artist_id`, `show_id` are all `NOT NULL` in the schema) — so "delete every channel, artist, and show" is exhaustive; there is no standalone content to handle separately.
- Cascades already reach `personal_playlists`' junction table (`playlist_videos.video_id REFERENCES videos(id) ON DELETE CASCADE`) and the equivalent for music/podcast favorites — so deleting all videos/tracks/episodes automatically empties playlists and subscriptions without deleting the playlists/subscriptions themselves, matching the scope decision below.
- The only existing "delete everything"-adjacent action, `clear-queue.post.ts`, only removes unstarted queue entries — it has no bearing on already-downloaded content and is not reused here beyond following its general "admin action under Settings" placement convention.
- Destructive-action confirmation everywhere else in the app is a plain `window.confirm()` (occasionally with a "WARNING:" prefix for the channel-delete case). This action is far more consequential than anything currently gated that way, so it gets a new, stronger pattern (see below) rather than reusing `window.confirm()`.

## Scope

**In scope:**
- New delete logic for music (artist-level, cascading to albums/tracks) and podcasts (show-level, cascading to episodes) — required groundwork, not user-facing on its own beyond being used by the wipe action.
- A new "wipe all libraries" action: deletes every channel (and its videos), every music artist (and their albums/tracks), and every podcast show (and its episodes) — files on disk and DB rows, in one operation.
- A pre-confirmation summary (item counts + estimated disk space) computed fresh at click time.
- A typed-confirmation gate (not a plain `confirm()`) before the action can run.
- A background job with a polling-based progress UI, matching the existing download-queue UX pattern.
- A final summary distinguishing successes from failures, continuing best-effort past individual failures rather than aborting.
- A "wipe in progress" flag that blocks starting a second wipe concurrently and pauses the three download-queue workers for the duration.
- Placement: a "Danger Zone" section in Settings → System tab.

**Out of scope (per the brainstorming decisions):**
- Deleting user accounts.
- Deleting personal playlists, channel subscriptions, or watch history as records — they are emptied as a side effect of cascading video/track/episode deletion, but the containers themselves survive.
- A general-purpose single-artist or single-show delete UI/button in the Music/Podcasts settings tabs — this project builds the underlying delete logic because the wipe action needs it, but does not add new user-facing single-item delete affordances beyond what already exists for video/channel. (A future project could surface these independently; not needed here.)
- Any change to the existing per-video or per-channel delete flows, which already work correctly.
- An orphan-file reconciliation/repair tool — a related but separate concern noted during investigation (DB/disk can already drift today from crashes or manual disk operations); this project does not attempt to detect or fix pre-existing drift, only to correctly delete what its own DB rows currently reference.

## Architecture

### New delete primitives (prerequisite work)

Two new functions, one per content type, mirroring the existing channel-delete route's logic exactly:

- `deleteMusicArtist(artistId)` (`server/utils/musicDownloader.ts` or a new `server/utils/musicDelete.ts`, matching whichever the implementation plan judges cleaner): cancels any in-flight download for the artist's tracks, resolves the artist's directory via the same `sanitizeFolderName(artist.name)` join used at download time, `fs.rmSync(dir, { recursive: true, force: true })`, then `DELETE FROM music_artists WHERE id = ?` (cascades to albums/tracks/favorites via existing FKs).
- `deletePodcastShow(showId)`: same shape for shows/episodes.

Both get their own admin API routes (`DELETE /api/admin/music/artists/[id]`, `DELETE /api/admin/podcasts/shows/[id]`) as the natural REST surface for this logic — even though this project doesn't add a UI button for them individually, having a real endpoint (not just an internal function) keeps the delete logic testable and consistent with how every other admin mutation in this app is already exposed.

### The wipe orchestrator

A new module (e.g. `server/utils/libraryWipe.ts`) holds:

- `getWipePreview()`: reads counts (`COUNT(*)` on `channels`, `videos`, `music_artists`, `music_tracks`, `podcast_shows`, `podcast_episodes`) and sums known file sizes (`SUM(size_bytes)` for videos; music/podcast tables' equivalent size columns, falling back to 0 for rows where size was never recorded) to produce an estimate — labeled as an estimate in the UI, since it can't account for on-disk drift.
- `isWipeInProgress()` / an in-memory flag (matching the existing `activeDownloadCount`-style in-memory state pattern already used throughout the downloader modules) — sets a flag for the duration of the wipe, checked by the three queue workers' loop conditions (alongside their existing `downloader_paused`-style checks) so no new download starts mid-wipe, and rejects a second wipe request while one is running.
- `runLibraryWipe()`: the background job. Iterates all channels (calling the existing channel-delete logic), then all music artists, then all podcast shows — one at a time, best-effort. Records a running progress state (current item type/name/index, total count so far) in memory, and a final report: `{ succeeded: [...], failed: [{ type, id, name, error }] }`.

### API surface

- `GET /api/admin/system/wipe-preview` → `{ channelCount, videoCount, artistCount, trackCount, showCount, episodeCount, estimatedBytes }`.
- `POST /api/admin/system/wipe-all` → starts the background job (rejects with 409 if one is already running), returns immediately.
- `GET /api/admin/system/wipe-status` → `{ inProgress: boolean, current: { type, name, index, total } | null, report: { succeeded, failed } | null }` — polled by the frontend, same shape/spirit as the existing download-queue status polling.

### UI

A "Danger Zone" panel in `SettingsSystemTab.vue`, styled distinctly (matching this app's existing `badge-danger`/`btn-danger-outline` conventions already used elsewhere in Settings) from the rest of the tab:

1. A "Preview" step: on opening the panel (or via a button), fetch and display the counts/estimated size.
2. A text input with a placeholder telling the admin to type an exact confirmation word (e.g. `SUPPRIMER`, matching this app's French-language admin copy elsewhere) — the "Wipe everything" button stays disabled until the typed value matches exactly.
3. On click: `POST /api/admin/system/wipe-all`, then begin polling `wipe-status` every ~1s (matching the existing queue-polling interval convention) and render "Deleting: <type> <name> (<index>/<total>)".
4. On completion: show the final report — a success count, and, if any failures occurred, an expandable list naming each failed item and its error (not silently swallowed, unlike today's per-file unlink failures).

## Error handling

- Any failure deleting one channel/artist/show (file permission error, disk error, an unexpected DB constraint issue) is caught, recorded in the `failed` list with its error message, and the wipe continues to the next item — matching this codebase's existing fault-tolerant philosophy for destructive operations (the current channel-delete route already swallows individual unlink failures with `console.error`; this project makes those failures visible in the final report instead of silently discarding them, which is a genuine improvement, not scope creep, since the report is a required part of this feature either way).
- If the wipe process itself crashes (server restart, unhandled exception) mid-run, `isWipeInProgress()`'s flag is in-memory only and will reset on restart — the next admin visit to the Danger Zone panel should show no "in progress" state, and the preview/counts will simply reflect whatever got deleted before the crash. No special recovery logic is added for this edge case; it's the same class of gap the app already has for a crashed single-channel delete, just at larger scale, and is explicitly not this project's job to solve (see Non-Goals: no orphan-reconciliation tool).

## Non-Goals

- No orphan-file reconciliation/repair tool (noted as a related, pre-existing gap during investigation, not built here).
- No undo/trash/soft-delete — deletion is immediate and permanent, matching how every other delete in this app already works.
- No scheduling/dry-run-only mode beyond the preview step described above.
- No change to the three pipelines' existing per-item concurrency or combined-cap settings.

## Testing

This is destructive, admin-only, filesystem-touching logic — matching this codebase's established convention, the file-deletion side (`fs.rmSync` calls, directory resolution) gets no automated tests (the existing channel/video delete routes have none either). The new pure logic that IS genuinely testable — `getWipePreview()`'s counting/summing query, and the progress-state bookkeeping in `runLibraryWipe()` (tracking current index/name, building the final `{succeeded, failed}` report shape) — should get real unit tests, following this project's established pattern of testing pure/testable slices even within a largely-untested I/O-heavy module (the same approach taken for `parseItunesDuration`/GUID-hashing in the podcast RSS ingestion pipeline). Manual verification (real admin session, real archived content, confirming files actually disappear from disk and the UI reports correctly) is required before merge, matching this app's established convention for this entire class of feature.
