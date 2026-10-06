# Video Storage Layout (one folder per video) + Tidy Tool — Design

**Status:** Approved (design sections 1–4 approved in chat)

## Goal

Make the video files on the server easy to browse and keep together: one folder per video holding the video, its thumbnail and its subtitles, all named after the video's title. Stop creating the duplicated channel folder (`e-penser 2.0/e-penser 2.0/`). Give the admin a manual, previewable tool to tidy the files that already exist, without ever moving anything silently.

User request (French, from a screenshot of an Unraid share): "c'est le bordel dans les dossiers, il faut ranger cela". Today everything for a channel sits in one folder with identifier-only names (`2EGF0xa-Fxk.mp4`, `.jpg`, `.fr.vtt`).

## Decisions taken with the user

- Layout: **one folder per video** (not a flat channel folder, not by year).
- Existing files: **manual tool with a preview and a confirmation** (not automatic at start-up, not "new downloads only").
- Scope: **videos and shorts**. Music and podcasts keep their current organisation.
- Language: the admin UI is English only (see the admin settings reorganisation spec).

## Context (verified in the code)

- `server/utils/downloader.ts` computes `channelDir = <resolveChannelBaseDir(channel.custom_save_path)>/<sanitizeFolderName(channel.title || channelId)>` and writes `<channelDir>/<videoId>.%(ext)s` (yt-dlp output template ~line 688; cancel cleanup at ~lines 28-38; post-download lookup of video/thumbnail/info.json at ~lines 845-880).
- The database stores web paths: `videos.local_video_path` and `videos.local_thumbnail_path` as `/downloads/<channelFolder>/<id>.<ext>` (built at ~lines 855 and 874). `server/routes/downloads/[...path].ts` serves a file by resolving `(custom_save_path or downloads dir)/<channelFolder>/<file>` from that URL.
- Subtitles are not stored in the database: `server/api/videos/[id].get.ts` (~lines 77-119) scans the channel folder for files starting with `<videoId>.` and ending in `.vtt`. `server/api/admin/videos/[id].delete.ts` (~lines 44-51) removes `<videoId>.*` files from the channel folder. `server/utils/videoDurations.ts` (new on branch `fix/home-duration-and-bento`) resolves `<base>/<channel folder>/<basename(local_video_path)>`.
- The duplicated folder comes from the old "Track" modal, which set `custom_save_path` to `<folder>/<channel title>` while the downloader appended the channel title again. The new Library "Follow" flow built the same path.
- `sanitizeFolderName` exists in the downloader utilities; yt-dlp writes `.info.json` which is parsed then deleted.

## Scope

**In scope:** a single path-building module; the downloader, file route, subtitle scan, video delete, cancel cleanup and duration backfill using it; the Follow flow no longer appending the channel folder to the save path; a "Tidy library files" tool (preview, confirm, batched move with progress, report).

**Out of scope:** music and podcast layouts; renaming a folder when a title later changes; moving files between different base folders / custom save paths; any change to how videos are listed or played.

## New layout

`<base>/<Channel>/<Title> [<id>]/` containing:
- `<Title> [<id>].mp4` (or the extension yt-dlp produced),
- `<Title> [<id>].jpg` (thumbnail),
- `<Title> [<id>].<lang>.vtt` for each subtitle language.
The `.info.json` is still deleted after being read. `<Channel>` is `sanitizeFolderName(channel.title || channelId)` as today.

Naming rules (one pure function, unit-tested): `<Title>` is the video title with path-forbidden characters (`\ / : * ? " < > |` and control characters) replaced, whitespace collapsed, leading/trailing dots and spaces removed, and truncated so that the whole base name (`<Title> [<id>]`) stays within 120 bytes of UTF-8 (the full file name with extension and language suffix must stay well below the common 255-byte limit; truncation never cuts inside a multi-byte character). An empty title falls back to the identifier. The identifier in brackets is mandatory and guarantees uniqueness.

## Path module

New `server/utils/videoPaths.ts`:
- `videoBaseName(title, id)` and `videoFolderName(title, id)` (same value) — the naming rules above.
- `buildVideoPaths({ baseDir, channelFolder, title, id })` → `{ dir, baseName, outputTemplate, videoUrlFor(ext), thumbUrlFor(ext), subtitleGlob }` where URLs follow the existing web shape `/downloads/<channelFolder>/<videoFolder>/<file>`.
- `resolveStoredPath(db, videoRow)` — the database is the source of truth: if `local_video_path` exists, derive the on-disk directory from it (mapping the `/downloads/...` URL the same way the file route does); only when a video has no stored path yet (a download in progress) is the folder computed from title+id.
Consumers switch to this module: downloader output template and post-download lookup, cancel cleanup, file route (must serve nested paths `/<channel>/<video folder>/<file>`, keeping its existing containment/traversal protection and Range handling), subtitle scan (scan the video's own folder for `*.vtt` when the video is in the new layout; keep the old `<id>.*` scan for legacy videos), video delete (remove the whole video folder when it is in the new layout and the folder contains only that video's files; legacy videos keep the current deletion), duration backfill.
Legacy videos (files directly in the channel folder, URLs `/downloads/<channelFolder>/<id>.<ext>`) continue to work unchanged until tidied. A video is "new layout" when its stored path has the extra folder level whose name ends with `[<id>]`.

## Follow flow fix

`videosSource` configuration in `app/utils/librarySources.ts` (Library → Videos "Options for new follows" → "Save folder"): the `custom_save_path` sent on ingest is the chosen base folder only (no channel title appended), because the downloader appends the channel folder. The "Save as default" and the per-channel "Edit options" paths follow the same rule. A short hint under the field says: "YouKeep adds a folder per channel and per video inside this folder." Existing channels whose `custom_save_path` already ends with their own folder name are handled by the tidy tool's duplicate-folder repair, not silently rewritten.

## Tidy tool

Location: Settings → System → Tools & logs, a "Tidy library files" block with an explanation sentence.
Endpoints (admin only, CSRF as usual):
- `POST /api/admin/library/tidy/preview` → computes the plan without touching disk: `{ total, toMove, alreadyTidy, conflicts, missingFiles, notWritable, duplicateFolders, samples: [{ id, title, from, to }] (up to 10), items count per channel }`.
- `POST /api/admin/library/tidy/start` → starts a background run (one at a time; refuses if a run, a library wipe, or a download write to the same video is in progress), returns immediately; `GET /api/admin/library/tidy/status` → `{ state: idle|running|done|failed|cancelled, processed, total, moved, skipped, errors, lastError }`; `POST /api/admin/library/tidy/cancel` stops after the current video.
Run algorithm, per video, batched (e.g. 25 per batch with a short yield between batches): skip videos whose download is not `completed`; compute the target folder; if the target already exists with different content → conflict (skip, counted); create the folder; move the video file, the thumbnail and every `<id>.*.vtt` subtitle that sits next to it (rename to the new base name; same-filesystem moves use `rename`, cross-device falls back to copy + verify size + then remove the source only after the copy is verified); verify the destination files exist and sizes match; only then update `local_video_path` / `local_thumbnail_path` in one transaction; on any failure for a video, leave its files where they were (restore any partial move) and record the error — never delete a file that was not successfully copied elsewhere; never delete anything outside the video's own files. Leftover empty channel/duplicate folders are removed only when completely empty. The run is resumable: re-running the preview shows what remains.
The duplicated folder case (`<base>/<Channel>/<Channel>/<id>.*`, where the stored URL folder is the outer name and the files live one level deeper because of a custom save path ending in the channel title) is detected from where the files actually are and is planned to the correct location `<base>/<Channel>/<Title> [<id>]/`, with the channel's `custom_save_path` corrected to the base folder once all its videos have been moved.
UI: preview panel (numbers and sample before/after paths), a "Start tidying" button enabled only after a preview, a progress bar while running, a final report, a "Cancel" button, English copy.

## Error handling

- File moved but database update failed: the move is reverted; if the revert also fails the video is reported as an error with both paths so the admin can fix it by hand; the run continues.
- Missing source file (database says completed, file gone): counted as `missingFiles`, skipped, never fails the run.
- Not writable destination: counted, skipped.
- Name collision: counted as conflict, skipped.
- A new download for a video that is being moved: skipped for that run (the tool checks the video's `download_status`).
- Process interrupted: no half state in the database (the update happens after verification, per video); files may exist in both places only between copy and verification during a cross-device fallback, and the next run detects and completes or cleans that case safely.

## Testing

- Unit: name building (forbidden characters, whitespace, truncation by bytes incl. multi-byte characters, empty title, very long title, uniqueness through the id); `buildVideoPaths` URLs; new-layout detection.
- Integration with a temporary directory as downloads dir and `createTestDb`: downloader path pieces (output template, post-download lookup of video/thumbnail/subtitles in the new layout), subtitle scan in both layouts, delete in both layouts (removes the folder only when it contains only that video's files), file route serving nested paths and still refusing traversal; the tidy planner and runner: preview counts and samples, a successful move (files, subtitles renamed, database updated), conflict, missing file, not writable, failure injected at the database step (files restored), cancel and resume, duplicate-folder repair, cross-device fallback via an injected move function.
- Component tests for the tidy panel (preview → confirm → progress → report; start disabled before a preview; failure states).
- Real verification in Docker with the Browser pane: ingest or seed real small videos in the legacy layout, run the preview and the tool, check the resulting folder tree on disk (`docker exec ls -R`), play a tidied video with its subtitles in the watch page, delete one tidied video and check its folder disappears, and confirm a new download is created in the new layout.
