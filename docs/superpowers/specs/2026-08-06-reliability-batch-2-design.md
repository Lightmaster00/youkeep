# Reliability Batch 2 — Design

## Context

Third sub-project of the ongoing "bug fixes" initiative, continuing the full-project audit backlog. Bundles 3 small, independent Important-severity findings, all with fix patterns already established elsewhere in this codebase this session:

1. Four hot-path columns have no index (`music_tracks.artist_id`, `music_tracks.album_id`, `comments.video_id`, `video_chapters.video_id`), used in `WHERE`/`JOIN` clauses across every music playlist endpoint and every video-detail page load.
2. `app/pages/watch/[id].vue`'s auto-advance-to-next-video `setTimeout` (in `handleVideoEnded()`) is never cleared. Since `/watch/[id]` is reused by Vue Router across navigations within the same route pattern (the component doesn't unmount when going from video A to video B), a user manually navigating away before the 1.5s countdown fires still gets force-navigated to the *original* next video, overriding their choice.
3. `ingestUrl()`'s single-video ingestion path ("Case B" in `server/utils/downloader.ts`) has the same `res.changes > 0` dead-code bug already found and fixed in playlist ingestion earlier this session: `res.changes` from an `INSERT ... ON CONFLICT DO UPDATE` is always truthy regardless of whether the conflicting row's values actually changed, so the branch distinguishing "already completed" from "re-added to queue" is unreachable — every single-video ingest of an already-completed video wrongly reports "added to the download queue" instead of "already present in the archive."

A fourth audit finding (admin endpoints forwarding raw `err.message` to clients) was explicitly excluded from this batch per the user's decision: it's admin-only (not a real exposure), and the detail is often genuinely useful for debugging failed yt-dlp runs. Left in the backlog, not scheduled.

## Scope

- Add the 4 missing indexes.
- Fix the `watch/[id].vue` timer leak.
- Fix `ingestUrl()`'s Case B dead-code bug.

## Non-Goals

- No fix for the admin error-message leakage finding (explicitly deferred per user decision).
- No other performance work beyond the 4 named indexes — the DB/perf audit's other findings (N+1 patterns, unbounded queries, statement caching) were assessed as lower-priority or already-acceptable and are not in scope here.
- No changes to `ingestUrl()`'s playlist branch (Case A, the "list=" branch) — its equivalent bug was already fixed in an earlier sub-project. This batch only touches Case B (single-video).

## Design

### 1. DB indexes

```sql
CREATE INDEX IF NOT EXISTS idx_music_tracks_artist_id ON music_tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_music_tracks_album_id ON music_tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);
CREATE INDEX IF NOT EXISTS idx_video_chapters_video_id ON video_chapters(video_id);
```

Added to the existing index block in `server/utils/db.ts` (the same `db.exec(...)` block already containing `idx_videos_channel_id` etc.), matching the existing naming convention (`idx_<table>_<column>`).

### 2. `watch/[id].vue` timer cleanup

A module-scoped `let autoNextTimer: ReturnType<typeof setTimeout> | null = null;` declared alongside the component's other local state. `handleVideoEnded()` stores the timer handle when it schedules the auto-advance. Two clearing points:
- The existing `watch(videoId, () => { descriptionExpanded.value = false; })` (which already fires exactly when a new video loads, whether via the auto-advance itself or a manual navigation) gains a `if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }` at its start — this is what actually closes the described bug, since it fires on every video change regardless of cause.
- The existing `onUnmounted(() => { document.removeEventListener('click', onDocumentClick); })` gains the same clear, as defense in depth for the case where the component genuinely does unmount (e.g. navigating away from `/watch/*` entirely) mid-countdown.

### 3. `ingestUrl()` Case B fix

Mirrors the pattern already used for playlist ingestion's video upsert. Before the `INSERT INTO videos ... ON CONFLICT DO UPDATE` in Case B, add a `SELECT download_status FROM videos WHERE id = ?` for the target video id, capturing its prior status (or `undefined` if the row doesn't exist yet). After the upsert runs (regardless of `res.changes`), branch the response message/count on that captured prior status instead of on `res.changes`:
- No prior row (new video): "added to the download queue", count 1.
- Prior row with `download_status !== 'completed'`: "re-added to the download queue", count 1.
- Prior row with `download_status === 'completed'`: "already present in the archive", count 0.

## Error Handling

- No new error paths introduced by any of the 3 fixes — all are either purely additive (indexes) or correctness fixes to existing logic with no new failure modes.

## Verification

- The DB index addition is testable indirectly via the existing test suite continuing to pass (additive schema change, no behavioral test needed for the indexes themselves — SQLite index presence doesn't change query *results*, only performance, which isn't something this project's test suite measures).
- The `ingestUrl()` Case B fix is testable: `server/utils/downloader.ts` has no existing automated test coverage for its yt-dlp-spawning logic (consistent with every prior sub-project touching this file) — this fix is manual-verification-only, consistent with that established project convention. Manual check: ingest a single video URL that's already `completed` in the DB and confirm the response message says "already present" with count 0, not "added to the download queue" with count 1.
- The `watch/[id].vue` timer fix has no automated test infrastructure available (zero Vue component test infrastructure in this codebase, confirmed and accepted across this entire session) — manual verification: play a playlist video to the end, let the "next video" toast countdown start, then immediately click a different recommended video before the 1.5s elapses; confirm the manually-selected video plays, not the original auto-advance target.
