# YouTube Playlist Download Ingestion — Design

## Context

Third of five independent YouKeep improvement items (Cache-Control headers and the music resync cron shipped first). Today, pasting a YouTube playlist URL (`youtube.com/playlist?list=...`) into the existing "Add Channel" field technically does *something*, but wrongly: `ingestUrl()`'s existing "Case A" branch treats any yt-dlp response shaped like `{_type: 'playlist', entries: [...]}` as a channel — which is structurally true for both a channel's video listing and a genuine playlist. For a real playlist, this creates a fake `channels` row keyed by the *playlist's* id and titled after the *playlist*, and attributes every video in it to that fake channel — losing the video's real uploader and polluting the followed-channels list with a non-channel entry. `personal_playlists`/`personal_playlist_videos` (in-app user-curated playlists) are unrelated and not reusable here — confirmed by reading their schema, which has no connection to YouTube sourcing at all.

Verified live against a real YouTube playlist in this sandbox (`yt-dlp --dump-single-json --flat-playlist`): each entry already carries its own `channel_id`/`channel` fields — the video's true uploader, independent of who created or owns the playlist. No extra per-video yt-dlp call is needed to get correct attribution.

## Scope

- A new, correctly-scoped code path in `ingestUrl()` (`server/utils/downloader.ts`) that detects a genuine playlist URL, fetches it once, and imports every video with its real channel attribution.
- Reuses the existing "Add Channel" input field — no new UI element, since the field already dispatches on URL shape (channel vs. single video) and this just adds a third shape.
- One-time batch import: videos are queued for immediate download, no ongoing tracking of "this came from playlist X," no resync when the source playlist later gains videos.

## Non-Goals

- No resyncable/followed playlist concept — re-pasting the same playlist URL later re-runs the same one-time import (new videos get added, since the video upsert is idempotent by video id; already-downloaded videos are untouched — this is a natural consequence of reusing the existing upsert, not new tracking machinery).
- No per-video visibility override for playlist-imported videos. This matches the existing, pre-existing behavior of single-video ingestion ("Case B" in `ingestUrl`), which also does not apply the `visibility` option to the inserted video row (only channel-level ingestion currently sets `channels.visibility` from that option) — this is a known, real inconsistency in the current code, not something this feature should silently paper over or extend further. Fixing per-video visibility handling in general is out of scope for this item.
- Newly-discovered channels (videos in the playlist from a channel YouKeep hasn't seen before) are registered passively (`sync_status = 'paused'`) purely for correct attribution/display — they do not become followed/resyncable channels. This mirrors single-video ingestion's existing channel-bootstrap behavior exactly.
- No playlist-level metadata (title, description) is stored anywhere — once videos are imported, the playlist itself leaves no trace in the data model, only its videos do.

## Design

### 1. Playlist URL detection

In `ingestUrl()`, before the existing `channelPattern` check, add a `playlistPattern` check: a URL contains a `list=` query parameter and is not itself a channel URL. This must run first — a URL can't be both, and the existing channel-detection regex must remain untouched so no channel-ingestion behavior changes.

### 2. Fetch and per-entry processing

The playlist branch uses the exact same yt-dlp invocation already used everywhere else in this function (`--dump-single-json --flat-playlist`), applied to the playlist URL directly. For each entry in the response's `entries` array:
- Skip entries with no `id` (defensive, matches existing entry-collection logic elsewhere in this file).
- If `entry.channel_id` doesn't already exist in `channels`, insert it with `sync_status = 'paused'`, mirroring the exact bootstrap block single-video ingestion already uses (including the same backgrounded, retried avatar/banner detail fetch — extracted as reusable logic rather than duplicated, since Case B's bootstrap block is identical in shape).
- Upsert the video into `videos` with `channel_id = entry.channel_id`, `download_status = 'pending'`, `is_manually_queued = 1` — same column set and same `ON CONFLICT` semantics as single-video ingestion's existing upsert (an already-completed video is left alone; a previously-failed/pending one is re-queued).

### 3. Triggering downloads

After processing every entry, `startQueueWorker()` is called unconditionally — matching single-video ingestion's "this is a manual, intentional action" behavior, not channel-following's conditional-on-sync_status behavior.

### 4. Response

Returns `{ success: true, message: "Playlist \"<title>\" imported. <N> video(s) added to the download queue.", count: N }`, where `<title>` is the playlist's own top-level `title` field (display-only, never persisted) and `N` is the count of videos that were newly inserted or re-queued (mirrors the existing `videosAdded`-style counting used elsewhere in this function).

## Error Handling

- A playlist URL that yt-dlp fails to resolve (private, deleted, network error) returns the same `{success: false, message}` shape the rest of `ingestUrl` already uses for fetch failures — no special-casing needed, this falls out of reusing the existing fetch/parse block.
- An entry missing required fields (`id`) is silently skipped, not counted, and does not fail the whole import — consistent with how malformed entries are already handled in the channel-ingestion path.
- A per-entry channel-bootstrap failure (e.g. the backgrounded avatar fetch failing) does not block or fail the video import itself — the video is still queued; only the channel's cosmetic details (avatar/banner) may end up missing, exactly as already true for single-video ingestion today.

## Verification

- Unit/integration tests are not feasible for `ingestUrl` itself (it spawns real `yt-dlp` processes, and this file has zero existing automated test coverage for its download-execution logic, consistent with every prior sub-project touching this class of code).
- Manual verification: paste a real playlist URL containing videos from at least two different channels (one already known to YouKeep, one not) into the existing Add Channel field; confirm each video gets its correct real channel attribution (not the playlist's own id/title), confirm the previously-unknown channel is created `paused` (not appearing as "followed" in the UI), confirm all videos are immediately queued and downloaded, confirm re-pasting the same playlist URL a second time doesn't re-download already-completed videos.
