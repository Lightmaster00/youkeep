# Reliability Batch 3 — Design

## Context

Sixth sub-project of the ongoing "bug fixes" initiative, continuing the Minor-severity backlog from the audit. Bundles 2 items, both requiring a real product decision made by the user during scoping:

1. **No disk-space check before starting a download.** Both queue workers (`server/utils/downloader.ts`'s `startQueueWorker()`, `server/utils/musicDownloader.ts`'s `startMusicQueueWorker()`) start downloads unconditionally once concurrency capacity is available, with no check for available disk space. A download can fail mid-write on a full disk, in whatever partially-cleaned-up state the download-lifecycle-reliability sub-project's error handling leaves it (retry, eventually `'failed'`).
2. **No way to un-pause a channel/artist after a bulk "resync all."** Confirmed during design exploration: a per-channel `POST /api/admin/channels/[id]/pause.post.ts` endpoint already exists in the backend (correctly flips `sync_status` to `'paused'`) but is never called from any UI — the channel `sync_status` badge in `channels.vue` is read-only display, not a toggle. The music pipeline has no equivalent endpoint at all.

Two related audit findings were explicitly scoped out during design, per user decision:
- **Combined video+music concurrency cap**: rejected — would be the first shared state between the two pipelines, violating the established "keep video and music pipelines fully independent" principle from an earlier sub-project (`project_video_music_improvements.md`). The residual risk (up to 4 concurrent downloads by default instead of 2) is minor and already user-configurable per pipeline.
- **Playlist-import queue-size limit**: rejected — the download queue already serializes work via the concurrency cap, so a huge playlist just queues a long wait, not a system-level failure.
- **Shorts under-detection in ordinary playlists**: confirmed to remain out of scope (re-affirmed during this sub-project's scoping, having already been declined twice) — the real fix needs an extra yt-dlp call per playlist entry, a real latency cost on large playlists that isn't worth the benefit.

## Scope

- Disk-space check before starting a download, in both queue workers, using Node's built-in `fs.promises.statfs()` (no new dependency).
- A pause/resume toggle exposed in the UI for channels (wiring the existing backend endpoint) and a new equivalent backend endpoint + UI toggle for music artists.

## Non-Goals

- No combined video+music concurrency cap (see Context).
- No playlist-import queue-size limit (see Context).
- No fix for Shorts under-detection in ordinary playlists (see Context).
- No changes to how the cron "resync all" itself behaves (it still unconditionally flips every channel/artist to `'downloading'`) — this batch only adds the missing manual revert, not a change to the bulk action's own semantics.

## Design

### 1. Disk-space check

A new shared helper in `server/utils/concurrency.ts` (already the shared home for `hasCapacityForMoreDownloads`/`parseMaxConcurrentDownloads`, used by both pipelines):

```ts
export const MIN_FREE_DISK_SPACE_BYTES = 500 * 1024 * 1024; // 500 MB

export async function hasEnoughDiskSpace(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.statfs(dirPath);
    const freeBytes = stats.bavail * stats.bsize;
    return freeBytes >= MIN_FREE_DISK_SPACE_BYTES;
  } catch {
    // If the check itself fails (e.g. platform doesn't support statfs, or the
    // directory doesn't exist yet), don't block downloads over an inability
    // to check — fail open, matching how a disk-space problem would surface
    // naturally anyway (the download itself would fail).
    return true;
  }
}
```

Called in both queue workers' main loop, right after the existing concurrency check and before querying for the next pending item — checked against `getDownloadsDir()` (video) / `getMusicDownloadsDir()` (music) respectively:

```ts
if (!(await hasEnoughDiskSpace(getDownloadsDir()))) {
  await sleepOrWakeable(5000);
  continue;
}
```

(Music worker: same shape, `getMusicDownloadsDir()` and `sleepOrWakeableMusic`.) A 5-second sleep before re-checking, matching the existing pause-check's sleep duration in the same loop, rather than the tighter 1-second concurrency-check sleep — disk space doesn't change as quickly as download slots freeing up, so a longer poll interval avoids needless churn.

### 2. Channel/artist pause-resume UI

**Video (channels.vue)**: confirmed during design exploration that the channel detail view (`v-if="channelId && channel"`, around line 4) already has a `.channel-actions-row` (around line 42) with admin action buttons (e.g. `handleToggleSubscription`), right below the read-only `sync_status` badge (line 30-32, "Sync Active"/"Sync Paused"). A new admin-only "Pause Sync"/"Resume Sync" button is added to that row: when `channel.sync_status === 'downloading'`, it calls the existing `POST /api/admin/channels/[id]/pause.post.ts`; when `'paused'`, it calls the existing `POST /api/admin/channels/[id]/sync.post.ts` (already flips to `'downloading'` as a side effect of triggering a sync — reused as the "resume" action rather than adding a new endpoint, since a resume is conceptually "start syncing again"). The badge itself stays read-only display, just now reflects a state the admin can actually change nearby.

**Music (new)**: a new `POST /api/admin/music/artists/[id]/pause.post.ts`, mirroring the video pause endpoint exactly (flips `music_artists.sync_status` to `'paused'`). Confirmed during design exploration that `app/pages/settings.vue`'s Music Ingestion panel (around line 695-720) already lists each followed artist with a `formatStatus(artist.sync_status)` label and an existing "Sync" button (`handleSyncMusicArtist`, calling the existing `sync.post.ts` — the resume direction already exists here). A new "Pause" button is added alongside it, shown when `artist.sync_status === 'downloading'`, calling the new pause endpoint — mirroring the video design's pause/resume pairing exactly, just in the pre-existing per-artist list this app already has instead of a dedicated detail-page header (music artists don't have the same kind of per-artist admin detail view channels do in this codebase).

## Error Handling

- The disk-space check's own failure (can't stat the directory) fails open (returns `true`, treated as "enough space") rather than blocking the queue over a check that couldn't run — a real disk-full condition still surfaces via the download itself failing, which the already-shipped retry/cleanup logic from the download-lifecycle-reliability sub-project already handles correctly.
- The new music pause endpoint returns `404` if the artist doesn't exist, mirroring the video pause endpoint's existing behavior exactly.

## Verification

- `hasEnoughDiskSpace()` is plain, testable logic (no yt-dlp involvement) — gets a real automated unit test, mocking `fs.promises.statfs` to simulate both low-space and sufficient-space conditions.
- The new music pause endpoint is plain DB/HTTP logic — gets a real automated integration test, mirroring the pattern of any existing per-item admin action test in this codebase.
- The queue-worker integration points (the `if (!(await hasEnoughDiskSpace(...)))` checks inside `startQueueWorker()`/`startMusicQueueWorker()`) are inside functions with zero existing automated test coverage (yt-dlp-spawning download-execution logic) — consistent with this project's established convention, these specific integration points are manual-verification-only.
- The UI toggles (channels.vue, and wherever the music artist list/detail view lives) have no automated test infrastructure (accepted, project-wide gap) — manual verification: pause a channel, confirm the badge reflects `'paused'` and it's excluded from the next resync-all's effective downloads (or rather, confirm resync-all still flips it — that's the accepted current behavior — but confirm the admin can manually re-pause it afterward via the new toggle); repeat for a music artist.
