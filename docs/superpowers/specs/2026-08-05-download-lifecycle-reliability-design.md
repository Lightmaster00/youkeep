# Download Lifecycle Reliability — Design

## Context

First item of a new "bug fixes" initiative, following a full-project audit (5 parallel read-only agent audits: security, download pipeline, DB/performance, frontend, code quality). This sub-project bundles 3 findings, all in the download-completion/failure handling of `server/utils/downloader.ts` (video pipeline) and its mirror `server/utils/musicDownloader.ts` (music pipeline), because they are causally coupled:

1. **Critical**: `downloadVideoFile`'s (and `downloadMusicTrackFile`'s) success-path DB write, inside the `child.on('close', ...)` handler, has no `try/catch`. If it throws (e.g. `SQLITE_BUSY` from a concurrent progress-update write), the enclosing promise never resolves or rejects — `runSingleDownload`'s `await` hangs forever, so its `finally` (release concurrency slot, wake worker) never runs. The video is permanently stuck at `download_status = 'downloading'` and a concurrency slot is leaked forever.
2. **Important**: `download_status = 'failed'` is never actually set in practice. Every call site of `cancelDownload`/`cancelMusicDownload` passes the default `targetStatus: 'pending'`, and the genuine-failure branch of `runSingleDownload`/`runSingleMusicDownload` also resets to `'pending'` (re-queuing at the tail via a bumped `created_at`). Consequence: a permanently broken video (deleted/private/geo-blocked) retries forever, endlessly consuming queue turns. Confirmed during design exploration that this silently broke an already-built feature: `/api/admin/downloader/retry-failed.post.ts`, its `failedCount` UI badge, the "Retry N Failed" button, and the per-item error box (`app/pages/settings.vue`) are all fully implemented and correct — they've just never had any `'failed'` rows to act on. The music side has the same gap, but with less UI: `musicFailedCount` is fetched but never rendered anywhere in the template, and no `/api/admin/music/retry-failed` endpoint exists at all.
3. **Important**: partial files (`.part`/`.ytdl` fragments, or a fully-downloaded-but-not-yet-DB-recorded file) are only cleaned up on the watchdog-timeout path and explicit cancel — not on an ordinary yt-dlp failure (non-zero exit code) or a process-spawn error. Since failures are common and (per finding 2) currently retried forever, fragments accumulate unbounded on every ordinary failure.

## Scope

- Guarantee the download-completion promise (video and music) always settles, on every exit path, with no possibility of hanging.
- Add a `retry_count` column to `videos` and `music_tracks`; after 3 genuine failures, mark `'failed'` instead of endlessly re-queuing as `'pending'`.
- Reset `retry_count` to 0 on success and on manual retry.
- Add `cleanupPartialFiles`/`cleanupPartialMusicFiles` calls to the two failure paths that currently skip it (process error, non-zero exit code), so cleanup runs on every failure, not just timeout/cancel.
- Give the music pipeline UI parity with video: a `/api/admin/music/retry-failed` endpoint and a rendered "Retry N Failed" button + per-track error box in `app/pages/settings.vue`, mirroring the existing video ones exactly.

## Non-Goals

- No differentiated retry policy for "permanent" vs "transient" failure causes (e.g. detecting "video is private" vs "network blip") — all genuine failures count toward the same 3-attempt cap uniformly, per the user's explicit choice.
- No configurable retry-count setting — the cap of 3 is a fixed constant, not an admin-configurable value.
- No changes to `downloadTrackClip`/manual clip backfill (`server/api/admin/music/tracks/[id]/download-clip.post.ts`) — this is a separate, non-queue code path with its own existing retry semantics (documented in its own comments), untouched by this work.
- No changes to the deliberate-pause/cancel branch's existing behavior (`isPausedGlobal || currentVideo?.download_status === 'pending'` in `runSingleDownload`) — that branch already correctly preserves progress/files and does not represent a failure; `retry_count` is not incremented on this path.
- No changes to `cancelDownload`/`cancelMusicDownload`'s existing `targetStatus` parameter or its call sites — those explicit "pending" resets (pause, manual cancel, clear-queue, delete) remain intentional user actions, not automatic-retry failures, and are out of scope for the `retry_count` counter.

## Design

### 1. Schema

```sql
ALTER TABLE videos ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE music_tracks ADD COLUMN retry_count INTEGER DEFAULT 0;
```

Added via the existing `try { db.exec(...) } catch (e) {}` migration pattern in `server/utils/db.ts`, and to the corresponding tables in `tests/helpers/testDb.ts`.

### 2. Always-settle guarantee

In `downloadVideoFile`'s `child.on('close', ...)` handler, the success branch (`code === 0`) currently does its file-locating and DB-write work directly inside the handler with no error containment. Wrap the DB write (the one lacking protection — file-locating logic that can only throw on `fs` calls already has narrower, acceptable failure modes handled by the existing `videoUrlPath` null-check) in a `try/catch`; on catch, call `settle(() => reject(err))` — the exact same call already used by the `code !== 0` branch just below it. This means a DB-write failure on the success path is treated identically to an ordinary yt-dlp failure: it flows through the same retry/failed logic (§3) and the same cleanup call (§4), rather than being a distinct, unhandled failure mode. Same change applied to `downloadMusicTrackFile`'s equivalent `close` handler.

This closes the hang completely: every branch of `close`, `error`, and the watchdog `setTimeout` now unconditionally calls `settle(...)`.

### 3. Retry-count and failed-status logic

In `runSingleDownload`'s `catch` block, the existing structure is:

```ts
if (isPausedGlobal || currentVideo?.download_status === 'pending') {
  // deliberate pause/cancel — unchanged, no retry_count involvement
} else {
  // genuine failure — currently always resets to 'pending' + requeue
}
```

The genuine-failure branch changes to read the video's current `retry_count`, increment it, and branch on whether it has now reached the cap:

- `retry_count < 3` (after increment): `download_status = 'pending'`, `download_progress = 0`, `created_at` bumped to now (existing requeue-at-tail behavior, unchanged), `retry_count` persisted, `last_error` persisted.
- `retry_count >= 3` (after increment): `download_status = 'failed'`, `download_progress = 0`, `created_at` **not** bumped (no requeue — a `'failed'` row is never picked up by the queue worker, since it only selects `download_status = 'pending'` rows), `retry_count` persisted, `last_error` persisted.

`retry_count` resets to 0 in two places:
- The success branch of `runSingleDownload` (`download_status = 'completed'` update) — added to the existing `SET` clause.
- `/api/admin/downloader/retry-failed.post.ts`'s existing `UPDATE` statements (both the single-video and retry-all branches) — added to the existing `SET` clause alongside the existing `last_error = NULL` reset.

Identical logic applied to `runSingleMusicDownload` and a new `server/api/admin/music/retry-failed.post.ts` (see §5).

The deliberate-pause/cancel branch is unchanged — it does not touch `retry_count`, so a video paused mid-download and later resumed keeps whatever `retry_count` it had, which is correct (a pause is not a failure).

### 4. Partial-file cleanup on every failure

`cleanupPartialFiles(videoId, channelId)` is added to two places in `downloadVideoFile` that currently lack it:
- `child.on('error', ...)` handler, right before `settle(() => reject(err))`.
- The `code !== 0` branch of `child.on('close', ...)`, right before `settle(() => reject(new Error(...)))`.

(The watchdog-timeout path and explicit `cancelDownload` already call this — unchanged.)

This means every failure, not just the final one that reaches `'failed'`, cleans up on the way out — each retry attempt starts from a clean slate rather than accumulating fragments across up to 3 attempts. Identical additions to `downloadMusicTrackFile` using `cleanupPartialMusicFiles(trackId, artistId)`.

### 5. Music pipeline UI parity

New `server/api/admin/music/retry-failed.post.ts`, structurally identical to the existing `server/api/admin/downloader/retry-failed.post.ts`: accepts an optional `trackId` in the body (single-track retry) or retries all `download_status = 'failed'` tracks, resetting `download_status = 'pending'`, `download_progress = 0`, `download_speed = NULL`, `download_eta = NULL`, `last_error = NULL`, `retry_count = 0`, then calls `startMusicQueueWorker()`.

`app/pages/settings.vue` gains a "Retry N Failed" button for the music panel, mirroring the existing video one exactly (same conditional `v-if="musicFailedCount > 0"`, same disabled-during-request pattern), calling a new `handleRetryAllMusicFailed()` function that POSTs to the new endpoint. The existing per-track error box pattern (`v-if="track.download_status === 'failed' && track.last_error"`, already present at `app/pages/settings.vue:767` per the audit) needs no changes — it already renders correctly once `'failed'` rows actually exist.

## Error Handling

- If the `retry_count` read/increment itself fails (extremely unlikely — same DB connection, same table, no new failure surface introduced beyond what already exists in this function), that exception propagates out of `runSingleDownload`'s `catch` block same as before this change — this is an acceptable, pre-existing risk boundary, not a new one introduced by this work.
- A `'failed'` video/track is not automatically retried by any cron or resync path — only by the explicit `retry-failed` endpoints (single-item or retry-all), consistent with the existing (currently-dead) design intent already visible in the UI.

## Verification

- `server/utils/downloader.ts` and `server/utils/musicDownloader.ts` have zero existing automated test coverage for their yt-dlp-spawning download-execution logic (confirmed repeatedly across every prior sub-project touching these files) — the `close`/`error` handler changes are not unit-tested directly, consistent with this established project convention.
- The `retry_count` increment/cap logic in `runSingleDownload`/`runSingleMusicDownload`'s catch block, and the two new/modified `retry-failed` endpoints, ARE plain, testable logic (DB reads/writes with no yt-dlp involvement) — these get real automated integration tests using the existing `tests/helpers/testDb.ts` pattern.
- Manual verification: since this fixes a promise-hang that's hard to trigger deterministically (requires a transient SQLite write failure at exactly the right moment), manual verification focuses on the observable, triggerable parts instead — queue a video pointing at a URL that will reliably fail (e.g. a deleted/private video id), confirm it retries up to 3 times (visible in logs/`retry_count`) then lands on `'failed'` with a populated `last_error`, confirm the "Retry N Failed" button appears and works for both video and music, and confirm no `.part`/`.ytdl` fragments are left behind in the channel/artist directory after a failed attempt.
