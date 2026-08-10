# Playlist Import Tuning — Design

## Context

Tenth sub-project of the ongoing "bug fixes" initiative — the second of 5 items reopened after the user explicitly asked to reconsider previously-declined audit findings ("corrige tout"). Two related findings, both about `ingestUrl()`'s ordinary-playlist-import branch in `server/utils/downloader.ts` (the code path for a URL matching `[?&]list=` that is NOT a channel — lines 1183-1245 as of this writing):

- **Shorts under-detection in ordinary playlists** (declined 3 times previously for cost reasons). Root cause found by reading the code: the current heuristic (`entryUrl.includes('/shorts/')`, line 1207) checks the entry's `webpage_url`/`url` for a `/shorts/` path segment — but YouTube's flat-playlist listing often normalizes a Short's URL to the ordinary `/watch?v=` form even inside a playlist context, so real Shorts are frequently missed. The original decline assumed fixing this required an extra per-entry yt-dlp call (real cost, correctly rejected). That assumption doesn't hold: each flat-playlist entry already carries `entry.duration` at zero extra cost (already read and stored at line 1227) — a duration-based heuristic (YouTube's current rule: Shorts are ≤ 60 seconds) can improve detection for free. This is a materially cheaper fix than what was originally declined, not a reconsideration of the same tradeoff.
- **Playlist-import queue-size limit** (declined because the existing concurrency cap already serializes queued downloads, so a huge playlist just waits longer with no *download-side* system risk). Still true for the download queue itself, but the *import* step is unguarded: `ingestUrl()`'s playlist branch loops synchronously over every entry in a single request/response cycle, running one `better-sqlite3` upsert per entry with no batching or size cap. A pathologically large playlist (some public "everything" playlists run into the tens of thousands of entries) would stall this synchronous loop for the full request. This is a distinct, real concern from the one originally declined — the decline addressed queue *processing*, not import-time *ingestion cost*.

Note the channel-import branch (Case A, `contentType === 'short'` derived from YouTube's own Shorts/Videos/Lives tab grouping in the channel's flat listing) is unaffected by either finding — it was never identified as under-detecting, and channels aren't subject to the same unbounded-single-playlist shape (channel sync is incremental/ongoing, not a one-shot bulk import).

## Scope

- Add a duration-based (`≤ 60s`) fallback signal to the ordinary-playlist-import Shorts detection, alongside the existing URL-shape check (either signal matching marks the entry as a Short).
- Cap the number of entries processed per ordinary-playlist import at 500; when a playlist has more, process only the first 500 and say so clearly in the response message.

## Non-Goals

- No change to Case A (channel import) — its Shorts detection is unaffected and already reliable.
- No change to the download-queue concurrency cap or any queue-processing behavior — this is purely about the import step.
- No new configuration UI/settings-table entry for the 500 limit — a named constant in `downloader.ts`, matching the existing `MIN_FREE_DISK_SPACE_BYTES` precedent (a previous sub-project's disk-space guard), not a user-configurable setting.
- No pagination/resumable-import mechanism for playlists over the limit — truncating to the first 500 and reporting the truncation is the whole fix; importing the remainder is out of scope.

## Design

In `server/utils/downloader.ts`'s ordinary-playlist-import branch (currently lines ~1184-1245):

1. **Size cap.** Add `const MAX_PLAYLIST_IMPORT_SIZE = 500;` near the top of the function (or file-level, matching where `MIN_FREE_DISK_SPACE_BYTES` lives). Before the `for (const entry of entries)` loop, compute `const totalEntries = entries.length;` and truncate: `const entriesToProcess = entries.slice(0, MAX_PLAYLIST_IMPORT_SIZE);`. Loop over `entriesToProcess` instead of `entries`.
2. **Shorts detection.** Change the existing line:
   ```ts
   const isShortFlag = entryUrl.includes('/shorts/') ? 1 : 0;
   ```
   to:
   ```ts
   const isShortFlag = (entryUrl.includes('/shorts/') || (typeof entry.duration === 'number' && entry.duration > 0 && entry.duration <= 60)) ? 1 : 0;
   ```
3. **Response message.** When `totalEntries > MAX_PLAYLIST_IMPORT_SIZE`, the returned `message` includes the truncation note, e.g.:
   ```ts
   const truncationNote = totalEntries > MAX_PLAYLIST_IMPORT_SIZE
     ? ` Playlist has ${totalEntries} entries — only the first ${MAX_PLAYLIST_IMPORT_SIZE} were processed.`
     : '';
   message: `Playlist "${playlistTitle}" imported. ${videosQueued} video(s) added to the download queue.${truncationNote}`,
   ```
   The `count` field in the return value stays `videosQueued` (already reflects only the processed/queued subset, no change needed there).

## Error Handling

No new error paths — the size cap is a silent truncation (reported in the success message, not an error), and the duration check falls back safely (`typeof entry.duration === 'number'` guards against `undefined`/`null`/non-numeric values, matching the existing `entry.duration || null` handling elsewhere in this function).

## Verification

`server/utils/downloader.ts` has no existing automated tests for `ingestUrl()` (confirmed by checking `tests/` — this file's yt-dlp-spawning logic is manual-verification-only, a project-wide, previously-established convention for this exact file). Verify manually via the dev-login fixture: trigger an ordinary-playlist import (a URL containing `?list=` that isn't a channel) against a real small public playlist containing at least one genuine Short whose URL doesn't contain `/shorts/`, and confirm it's now flagged `is_short = 1`. For the size cap, either test against a real playlist with 500+ entries (if a suitable public one is available) or verify the truncation logic directly by reading the code path with a mocked/synthetic large `entries` array in a scratch script, and confirm the response message correctly reports the truncation.
