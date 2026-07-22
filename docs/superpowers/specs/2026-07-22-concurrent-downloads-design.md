# Concurrent Downloads — Design

## Context

Last remaining item from the downloader feature wishlist (see project memory `project_downloader_feature_wishlist`), after chapters/SponsorBlock (`docs/superpowers/specs/2026-07-21-chapters-sponsorblock-design.md`) and selective channel playlist download (`docs/superpowers/specs/2026-07-22-channel-playlist-download-design.md`).

The queue worker (`startQueueWorker` in `server/utils/downloader.ts:250`) currently processes one video at a time: it picks the next `pending` video, `await`s `downloadVideoFile` to completion (success or failure), updates the video's status, then loops to pick the next one. Only one yt-dlp process ever runs at once.

The per-video tracking already anticipated concurrency: `activeProcesses` (`server/utils/downloader.ts:87`) is a `Map<videoId, child process>`, not a single value, and every status update, progress field, and cancel action is already keyed by `video.id`. The admin Queue UI (`app/pages/settings.vue`) renders one card per video from a `v-for` over the full queue list, with its own progress bar, speed, ETA, and cancel button per card — nothing in it assumes a single active download. This means the work is concentrated almost entirely in the worker loop itself.

## Scope

Let multiple videos download at once, up to an admin-configurable limit, applied globally across the whole instance (not per-channel). Changing the limit takes effect immediately on the running worker — raising it starts new downloads right away, lowering it lets in-flight downloads finish without starting new ones until back under the limit.

## Non-Goals

- Per-channel concurrency limits (one global limit only).
- Any change to the Queue UI's rendering — it already supports multiple simultaneous `downloading` rows with no changes needed.
- Bandwidth shaping/throttling per download (yt-dlp's own rate-limit flags, if ever added, are a separate concern).

## Design

### 1. Setting

New key in the existing `settings` table (same table as `downloader_paused`): `max_concurrent_downloads`, default `2`. A new admin get/set endpoint pair, following the exact pattern already built for the SponsorBlock settings (`server/api/admin/downloader/sponsorblock.get.ts` / `.post.ts`).

### 2. Orchestrator loop (replacing the current sequential loop)

The `while (getWorkerShouldRun())` loop in `startQueueWorker` changes shape. Each iteration:

1. If globally paused (existing `downloader_paused` check, unchanged): sleep and re-check, same as today.
2. Read `max_concurrent_downloads` from `settings` (read fresh every iteration — this is what makes the limit apply live).
3. If `activeProcesses.size >= max_concurrent_downloads`: no room, sleep and re-check (reuses `sleepOrWakeable`, same wake-on-new-work mechanism already in place).
4. Otherwise, look for the next `pending` video (same query as today, unchanged — priority, shorts-first, resume-partial-first, `created_at` ordering). If none, sleep and re-check.
5. If a video is found: mark it `downloading` in the DB (same UPDATE as today), then call `downloadVideoFile(video.id, video.channel_id)` **without awaiting it**. Its `.then()`/`.catch()` chain does exactly what the current `try`/`catch` block around the `await` does today — mark `completed` on success; on failure, distinguish intentional pause/cancel (revert to `pending`, keep progress) from a real error (revert to `pending`, reset progress, bump `created_at` to push it to the back of the queue, record `last_error`) — this logic is moved as-is into the promise chain, not changed.
6. Loop immediately (no fixed delay) back to step 1, so a freed-up slot or newly raised limit is picked up on the next iteration rather than waiting out a sleep timer that was started before the change.

Because `better-sqlite3` calls are synchronous and Node is single-threaded, the "read next pending video" (step 4) and "mark it downloading" (step 5) happen back-to-back with no `await` between them — so even with several such picks happening in overlapping iterations, there's no race where two iterations grab the same video. No new locking is needed.

The 2-second post-failure backoff that exists today is kept, but scoped to that single video's `.catch()` handler — it no longer blocks the orchestrator from picking up other work while it waits.

### 3. Stop/pause semantics (unchanged)

`stopQueueWorker()` still just flips `setWorkerShouldRun(false)`; the orchestrator loop exits once it next checks the flag, same as today. In-flight, un-awaited downloads are not cancelled by this — they run to completion (or failure) independently, exactly as an in-flight download today isn't interrupted by a stop request. `downloader_paused` continues to mean "don't start anything new," now interpreted as "don't start anything new across any slot."

### 4. Settings UI

In `app/pages/settings.vue`, next to the existing pause/resume control for the downloader, add a small numeric input for `max_concurrent_downloads` (minimum 1), saved through the new endpoint.

## Error Handling

- A crash inside one video's `.then()/.catch()` chain must not take down the orchestrator loop — it's already isolated by being a separate promise chain (unlike today, where an unhandled exception would propagate into the shared `try`/`catch` around the loop body). The existing "5 consecutive system errors stops the worker" safeguard (`server/utils/downloader.ts:347-353`) is kept for errors in the orchestrator loop itself (e.g. DB errors picking the next video), not for individual download failures, which are already handled per-video.
- Invalid values for `max_concurrent_downloads` (zero, negative, non-numeric) are rejected by the settings endpoint; the orchestrator treats a missing/unparseable setting as the default of `2`.

## Verification

- Set the limit to 3, queue 5+ pending videos on an active channel → confirm 3 downloads run concurrently (3 `downloading` rows in the Queue UI, 3 entries in `activeProcesses`), and the 4th starts as soon as one of the first 3 finishes.
- While 3 are running, lower the limit to 1 → confirm no new download starts until 2 of the 3 in-flight ones finish, then only one replacement starts.
- While running, raise the limit → confirm a new download starts within moments, without needing to pause/resume.
- Cancel one of several concurrent downloads → confirm only that one stops; the others continue unaffected (existing per-video cancel logic, unchanged).
- Global pause with several downloads in flight → confirm in-flight downloads finish (or can still be cancelled) but no new ones start until resumed.
- A single video's download throws an error while others are in flight → confirm the failing video reverts to `pending` with `last_error` set and the other concurrent downloads are unaffected.
