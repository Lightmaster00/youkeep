# Music Clips (Sub-project 6) — Design

## Context

Sixth and (per the current Music mode roadmap) final sub-project. Sub-projects 1-5 are done and merged: data model, YouTube ingestion, full library UI, audio player with smart playlists, and an on/off module toggle. This sub-project was previously deferred specifically to wait for the rest of Music mode to land (see `project_downloader_feature_wishlist` memory).

"Clip" here means the official music video for a track — in French, "clip" commonly means "music video" ("clip officiel"). This is **not** YouTube's "Clips" product feature (short trimmed-segment share URLs); no code in this repo references that feature today. A music track already ingested as audio-only has its `music_tracks.id` set to the source YouTube video id (`data.id` from yt-dlp), so the "clip" for a track is, in the common case, the exact same YouTube video the audio was extracted from — just with the video stream kept instead of discarded.

## Scope

- Optionally download and store the video stream alongside (in the same file as) a track's audio, so the same YouTube video already used for a track's audio can also be watched as a "clip."
- A global setting controlling whether newly-ingested tracks (for any followed artist) download clips automatically.
- A per-track manual "download clip" action for admins to back-fill existing audio-only tracks.
- Client UI: a pill/badge on any track that has a clip, and an inline video mode in the persistent mini-player that swaps the audio element for a video element on the same file, preserving playback position and queue behavior (next/prev/shuffle/repeat all keep working).

## Non-Goals

- No support for a clip video that differs from the track's audio source video — if a future need arises to link a different YouTube URL as a track's clip, that's out of scope here.
- No re-encoding, no video quality selection UI — reuses the exact format-selection string already used by the video module (`bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`, merged to mp4).
- No automatic backfill of the ~295 already-ingested audio-only tracks — only a manual, per-track "download clip" action; no bulk/per-artist backfill button.
- No standalone full-screen or modal video page — clip playback is inline in the existing persistent mini-player only.
- No change to admin-only gating conventions — all clip-download endpoints (automatic setting, manual per-track trigger) follow the exact `requireAdmin` pattern already used by every other music admin endpoint.

## Design

### 1. Data model

Add one column to `music_tracks`:

```sql
ALTER TABLE music_tracks ADD COLUMN has_clip INTEGER DEFAULT 0;
```

`has_clip = 1` means the file at `local_file_path` is the fused video+audio mp4 (not the lightweight audio-only file). No new `local_video_path` column and no new table — because the clip and the audio share one physical file (see §2), `local_file_path` already points at the right file in both cases; `has_clip` just tells the client and the server which kind of file it is.

New setting `music_download_clips` (`'1'`/`'0'`, default `'0'`) in the existing `settings` table, seeded the same way as `music_downloader_paused`/`music_max_concurrent_downloads`/`music_module_enabled`.

### 2. Ingestion pipeline (`server/utils/musicDownloader.ts`)

When downloading a track (new artist follow-sync, or any future new-track ingestion), the worker reads `music_download_clips` before building its yt-dlp args:

- **Disabled (default):** unchanged — `-x` audio-only extraction, `local_file_path` = lightweight audio file, `has_clip = 0`.
- **Enabled:** instead of `-x`, use the video module's exact merged-format string (`bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`, `--merge-output-format mp4` when ffmpeg is available), output to the same `data/downloads-music/{artist}/{trackId}.mp4` naming convention. On success, `local_file_path` = that mp4, `has_clip = 1`.

Everything else in the pipeline (metadata parsing, thumbnail handling, download-status tracking, queue/concurrency worker) is unchanged — only the yt-dlp format argument and the `has_clip` flag depend on the setting.

**Fallback on partial failure:** if the merged-format download fails but a plain audio-only download of the same video would likely succeed (e.g. video stream geo-restricted while audio isn't), fall back to `-x` audio-only extraction for that track rather than leaving it fully failed. `has_clip` stays `0`, and `last_error` records that a clip fallback occurred, so the track is still listenable.

### 3. Manual per-track backfill (admin)

New endpoint `POST /api/admin/music/tracks/[id]/download-clip.ts`:
- `requireAdmin`.
- 404 if the track id doesn't exist.
- 409 Conflict if the track already has `has_clip = 1` (nothing to do).
- Enqueues a re-download of `https://www.youtube.com/watch?v={id}` using the same merged format as §2, reusing the existing music download queue/concurrency worker rather than blocking the request — this is "ingestion," not a synchronous action.
- On success, the new mp4 atomically replaces the old audio-only file (download to a temp path first, only `fs.rename` over the old file and update `local_file_path`/`has_clip` after the new file is fully written) — the existing audio-only file must never be deleted before the replacement is confirmed on disk.
- On failure, the track is left completely unchanged (still playable in audio mode), with `last_error` set for admin visibility.

A "Télécharger le clip" button appears next to any track without a clip in the admin-facing parts of `/music` (artist detail view).

### 4. Serving (`server/routes/downloads-music/[...path].ts`)

Add `.mp4: 'video/mp4'` to the existing content-type map. The Range-request support already built for audio streaming (sub-project 4) is generic and needs no changes to serve mp4 with the same 206/416 behavior. Access control is unchanged — `canAccessMusicTrack` applies identically to a clip as to the audio file it replaces, since it's the same track and the same visibility tier.

### 5. Client UX — pill + inline clip mode

- A "🎬 Clip" pill appears on any track row (list view, mini-player) where `has_clip = 1`. Absent otherwise — no "clip unavailable" state needed for non-admins.
- Clicking the pill sets a new `clipMode: boolean` ref in `useMusicPlayer.ts`. The mini-player's audio element becomes a `<video>` element instead of `<audio>` for that same file — both element types share the `HTMLMediaElement` interface, so `useMusicPlayer`'s `audioEl` ref is typed as `HTMLMediaElement` rather than `HTMLAudioElement`, and the component swaps which tag it mounts based on `clipMode`. Since both point at the exact same file, `currentTime` carries over directly with no re-seek/re-buffer logic needed.
- A button in the mini-player toggles back to audio mode (cover art) without losing playback position.
- Clip mode shares the same queue/next/prev/shuffle/repeat state as normal playback — it's a display-mode change on the existing player, not a separate player instance.
- If the queue advances (next/prev/shuffle) to a track without a clip while clip mode is active, clip mode automatically turns off (falls back to cover art) rather than showing a broken video element.

### 6. Settings UI

New toggle "Télécharger aussi les clips vidéo" in Settings' Music tab, positioned above the existing ingestion panel, following the same optimistic-update-with-rollback pattern as the sub-project 5 module toggle. New endpoints:
- `GET /api/settings/music-clips` — public read, `{ enabled: boolean }`. Mirrors sub-project 5's `GET /api/settings/music-module` convention structurally (try/catch around the DB read from the start, learning from its fix round) but the fail-open *direction* is intentionally the opposite: on any read error this endpoint defaults to `enabled: false`, not `true`. For the module toggle, the safe default was "assume visible" (a read glitch shouldn't accidentally hide the whole module). For clips, the safe default is "assume disabled" — a read glitch shouldn't cause the client to show clip pills/attempt clip downloads based on stale or wrong state. Each setting's fail-open default is chosen for its own least-surprising direction, not copied mechanically from the last one.
- `POST /api/admin/settings/music-clips` — admin-only write, upsert (not bare `UPDATE`, learning directly from sub-project 5's Task 2 finding), body-validates `{ enabled: boolean }`.

### 7. Error handling

- Automatic clip download that fails but plain audio would succeed: falls back to audio-only (§2) rather than failing the track entirely.
- Manual backfill failure: existing audio file is never deleted before the replacement succeeds (temp-file-then-atomic-rename); track stays fully playable in audio mode on failure, error surfaced to the admin via `last_error`.
- Video element load error in clip mode (e.g. file moved/deleted after the pill was shown): falls back to audio mode automatically, same guard as the no-clip-on-next-track case.

## Verification

- Endpoint tests: `download-clip.post.ts` (admin-only, 404 for missing track, no-op/409 if already has a clip, enqueues correctly); `GET`/`POST` for `music-clips` setting (mirrors sub-project 5's test shape: public fail-open read, admin-gated upsert write, 400 on non-boolean body).
- Browser: enable the global setting, follow a new artist, confirm a newly-ingested track has `has_clip = 1` and a `.mp4` file; click the clip pill on a track, confirm the mini-player shows video at the correct position and that next/prev/shuffle/repeat keep working in clip mode; manually back-fill an existing audio-only track (e.g. an existing GIMS track) and confirm the file is replaced without breaking playback; confirm a track without a clip shows no pill; confirm switching to a clip-less track while in clip mode falls back to audio mode cleanly.
- `npx vue-tsc -b --noEmit` clean beyond the 2 known pre-existing errors.
