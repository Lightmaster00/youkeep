# Download Lifecycle Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee the video/music download-completion lifecycle never hangs, actually uses `download_status = 'failed'` after 3 genuine failures instead of retrying forever, and cleans up partial files on every failure path.

**Architecture:** Three coupled fixes applied in parallel to the video pipeline (`server/utils/downloader.ts`) and the music pipeline (`server/utils/musicDownloader.ts`): (1) the success-path DB write in each `close` handler is wrapped so it can never leave the enclosing promise unsettled, (2) a new `retry_count` column tracks genuine failures and flips `download_status` to `'failed'` at 3, (3) partial-file cleanup is added to the two failure paths that currently skip it. A new `retry-failed` endpoint and UI button give the music pipeline the same "Retry N Failed" capability the video pipeline already has (but never had working data to act on).

**Tech Stack:** Nuxt 4, Nitro (H3), better-sqlite3, Vue 3 Composition API, Vitest, yt-dlp (spawned as a child process).

## Global Constraints

- No differentiated retry policy for "permanent" vs "transient" failure causes — all genuine failures count toward the same 3-attempt cap uniformly.
- No configurable retry-count setting — the cap of 3 is a fixed constant, not admin-configurable.
- No changes to `downloadTrackClip`/manual clip backfill (`server/api/admin/music/tracks/[id]/download-clip.post.ts`) — separate code path, untouched.
- No changes to the deliberate-pause/cancel branch's existing behavior (`isPausedGlobal || currentVideo?.download_status === 'pending'` in `runSingleDownload`/`runSingleMusicDownload`) — `retry_count` is not incremented on this path.
- No changes to `cancelDownload`/`cancelMusicDownload`'s existing `targetStatus` parameter or its call sites.
- `server/utils/downloader.ts` and `server/utils/musicDownloader.ts` have zero automated test coverage for their yt-dlp-spawning download-execution logic (confirmed repeatedly across every prior sub-project touching these files) — Tasks 2-5 in this plan are manual-verification-only, not automated-test tasks. Only Tasks 6-7 (the retry-failed endpoints, plain DB/HTTP logic with no yt-dlp involvement) get automated tests.

---

### Task 1: `retry_count` schema migration

**Files:**
- Modify: `server/utils/db.ts:279` (add migration line)
- Modify: `tests/helpers/testDb.ts` (keep test schema in sync — both the `videos` and `music_tracks` hand-written `CREATE TABLE` statements)

**Interfaces:**
- Produces: `videos.retry_count INTEGER DEFAULT 0` and `music_tracks.retry_count INTEGER DEFAULT 0` columns, read/written by Tasks 3, 5, 6, 7.

- [ ] **Step 1: Add the production migration**

In `server/utils/db.ts`, the video/music migration lines currently read (lines 276-284):

```ts
  try { db.exec(`ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN like_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN last_error TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN was_live INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_history ADD COLUMN watch_time_seconds INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN local_file_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN local_thumbnail_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN size_bytes INTEGER;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN has_clip INTEGER DEFAULT 0;`); } catch (e) {}
```

Add two new lines after the `has_clip` line:

```ts
  try { db.exec(`ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN like_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN last_error TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN was_live INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_history ADD COLUMN watch_time_seconds INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN local_file_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN local_thumbnail_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN size_bytes INTEGER;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN has_clip INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}
```

- [ ] **Step 2: Keep the test DB schema in sync**

`tests/helpers/testDb.ts` hand-writes its own `CREATE TABLE videos (...)` and `CREATE TABLE music_tracks (...)` (it does not run the production migrations). Find the `videos` table definition (search for `CREATE TABLE videos`) and add `retry_count INTEGER DEFAULT 0,` next to the existing `is_short INTEGER DEFAULT 0,` line. Find the `music_tracks` table definition (search for `CREATE TABLE music_tracks`) and add `retry_count INTEGER DEFAULT 0,` next to the existing `has_clip INTEGER DEFAULT 0,` line (or wherever a similar `DEFAULT 0` integer column sits — match the existing style).

If `music_tracks` isn't yet defined with a `has_clip` column in this test helper file, add `retry_count INTEGER DEFAULT 0,` immediately before the table's closing `);` instead — read the actual current table definition first, since this file's `music_tracks` schema may already include columns not enumerated here.

- [ ] **Step 3: Run the test suite to confirm the schema change doesn't break anything**

Run: `npm test -- --run`
Expected: all existing tests still pass (additive columns with defaults, no existing test asserts an exact column list). Note the exact pass count and exit code.

- [ ] **Step 4: Commit**

```bash
git add server/utils/db.ts tests/helpers/testDb.ts
git commit -m "feat: add retry_count column to videos and music_tracks"
```

---

### Task 2: Guarantee `downloadVideoFile()` always settles, and cleans up on every failure

**Files:**
- Modify: `server/utils/downloader.ts` (the `downloadVideoFile` function's `child.on('error', ...)` handler and `child.on('close', ...)` handler)

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task doesn't touch `retry_count`).
- Produces: a `downloadVideoFile()` promise that is now guaranteed to settle on every exit path, and calls `cleanupPartialFiles` on every failure path (not just timeout/cancel). Task 3 (`runSingleDownload`'s catch block) relies on this always-settling guarantee to make its retry/failed logic reachable in all cases.

- [ ] **Step 1: Add cleanup to the `error` handler**

The handler currently reads:

```ts
    child.on('error', (err) => {
      clearTimeout(watchdog);
      addLog(`yt-dlp [${videoId}] process error : ${err.message || err}`);
      activeProcesses.delete(videoId);
      settle(() => reject(err));
    });
```

Add a `cleanupPartialFiles(videoId, channelId)` call before the `settle(...)` line:

```ts
    child.on('error', (err) => {
      clearTimeout(watchdog);
      addLog(`yt-dlp [${videoId}] process error : ${err.message || err}`);
      activeProcesses.delete(videoId);
      cleanupPartialFiles(videoId, channelId);
      settle(() => reject(err));
    });
```

- [ ] **Step 2: Wrap the success-path DB write in try/catch, and add cleanup to the non-zero-exit-code branch**

The `close` handler's success branch currently ends with (after locating the video/thumbnail files and parsing the info.json):

```ts
        const fileSize = videoUrlPath && fs.existsSync(videoFile) ? fs.statSync(videoFile).size : null;

        db.prepare(`
          UPDATE videos 
          SET local_video_path = ?, 
              local_thumbnail_path = ?,
              description = COALESCE(?, description),
              view_count = COALESCE(?, view_count),
              upload_date = COALESCE(?, upload_date),
              like_count = COALESCE(?, like_count),
              size_bytes = ?,
              was_live = ?
          WHERE id = ?
        `).run(
          videoUrlPath,
          thumbnailUrlPath,
          desc,
          views,
          uploadDate,
          likeCount,
          fileSize,
          wasLive,
          videoId
        );
        settle(() => resolve());
      } else {
        const errorMsg = lastStderr ? `yt-dlp a échoué (code ${code}) : ${lastStderr}` : `yt-dlp a échoué avec le code ${code}`;
        settle(() => reject(new Error(errorMsg)));
      }
    });
```

Replace it with:

```ts
        const fileSize = videoUrlPath && fs.existsSync(videoFile) ? fs.statSync(videoFile).size : null;

        try {
          db.prepare(`
            UPDATE videos 
            SET local_video_path = ?, 
                local_thumbnail_path = ?,
                description = COALESCE(?, description),
                view_count = COALESCE(?, view_count),
                upload_date = COALESCE(?, upload_date),
                like_count = COALESCE(?, like_count),
                size_bytes = ?,
                was_live = ?
            WHERE id = ?
          `).run(
            videoUrlPath,
            thumbnailUrlPath,
            desc,
            views,
            uploadDate,
            likeCount,
            fileSize,
            wasLive,
            videoId
          );
          settle(() => resolve());
        } catch (dbErr: any) {
          // The video/thumbnail files downloaded successfully, but the DB write that
          // records them failed (e.g. a transient SQLITE_BUSY from a concurrent
          // progress-update write). Treat this identically to an ordinary yt-dlp
          // failure — same rejection, same cleanup — so the promise always settles
          // instead of hanging forever, and the caller's retry logic can pick it up.
          settle(() => reject(dbErr));
        }
      } else {
        const errorMsg = lastStderr ? `yt-dlp a échoué (code ${code}) : ${lastStderr}` : `yt-dlp a échoué avec le code ${code}`;
        cleanupPartialFiles(videoId, channelId);
        settle(() => reject(new Error(errorMsg)));
      }
    });
```

Note: `cleanupPartialFiles` is intentionally NOT added inside the new `catch (dbErr)` block — in that case the video file downloaded successfully and deleting it would throw away a valid, complete download over what is likely a transient DB issue. Only the non-zero-exit-code (`else`) branch, where yt-dlp itself failed and no valid file exists, gets the cleanup call.

- [ ] **Step 3: Manual verification**

This function has zero automated test coverage (consistent with every prior sub-project touching this file) — verify manually instead:

1. Start the dev server (`npm run dev`).
2. Queue a video with a URL that will reliably fail (e.g. a known-deleted or known-private YouTube video id, or temporarily point at an invalid URL).
3. Confirm in the logs (`addLog` output, visible in the admin Downloads panel) that the failure is logged and the video's `download_status` returns to `pending` (not stuck at `downloading`).
4. Confirm no `.part`/`.ytdl` fragment files are left in the channel's download directory after the failure (check the filesystem directly).
5. Queue a normal, working video and confirm it still downloads and completes successfully — this change must not break the success path.

Report what you observed.

- [ ] **Step 4: Commit**

```bash
git add server/utils/downloader.ts
git commit -m "fix: guarantee downloadVideoFile always settles and cleans up on every failure"
```

---

### Task 3: `retry_count` and `'failed'` status in `runSingleDownload()`

**Files:**
- Modify: `server/utils/downloader.ts` (the `runSingleDownload` function)

**Interfaces:**
- Consumes: `videos.retry_count` column from Task 1; relies on Task 2's always-settle guarantee to ensure this function's `catch` block is reliably reached on every failure.
- Produces: after this task, a video that fails 3 times in a row lands on `download_status = 'failed'` instead of retrying forever. Task 6 (`retry-failed.post.ts`) resets `retry_count` back to 0 to let a `'failed'` video be retried again.

- [ ] **Step 1: Add `retry_count = 0` to the success branch**

The function currently reads (full function, for context — only the two `UPDATE` statements inside it change):

```ts
async function runSingleDownload(videoId: string, videoTitle: string, channelId: string): Promise<void> {
  const db = getDb();
  try {
    await downloadVideoFile(videoId, channelId);

    // Mark as completed
    db.prepare(`
      UPDATE videos
      SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, is_manually_queued = 0, last_error = null
      WHERE id = ?
    `).run(videoId);
    addLog(`Téléchargement RÉUSSI : "${videoTitle}"`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    addLog(`ÉCHEC du téléchargement pour la vidéo "${videoTitle}" (${videoId}) : ${errMsg}`);

    // Check if the download was interrupted intentionally (e.g. paused/cancelled via API or global paused setting)
    const currentVideo = db.prepare('SELECT download_status FROM videos WHERE id = ?').get(videoId) as { download_status: string } | undefined;
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
    const isPausedGlobal = pausedSetting?.value === '1';

    if (isPausedGlobal || currentVideo?.download_status === 'pending') {
      addLog(`Téléchargement de la vidéo "${videoTitle}" (${videoId}) interrompu ou mis en pause intentionnellement.`);
      // Ensure status is pending, speed/eta are null, but preserve progress and files
      db.prepare(`
        UPDATE videos
        SET download_status = 'pending', download_speed = null, download_eta = null
        WHERE id = ?
      `).run(videoId);
    } else {
      // Put the video back to pending but move it to the end of the queue by updating created_at
      db.prepare(`
        UPDATE videos
        SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, is_manually_queued = 0, last_error = ?, created_at = ?
        WHERE id = ?
      `).run(errMsg, Date.now(), videoId);
    }
    // Brief pause so a rapidly-failing video isn't immediately re-picked; scoped to this
    // video's own task so it doesn't block the orchestrator or other concurrent downloads.
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    decrementActiveDownloadCount();
    // Wake the orchestrator in case it's sleeping on a "no capacity" or "no work" check
    wakeWorker();
  }
}
```

Replace the whole function body with:

```ts
async function runSingleDownload(videoId: string, videoTitle: string, channelId: string): Promise<void> {
  const db = getDb();
  const MAX_RETRY_COUNT = 3;
  try {
    await downloadVideoFile(videoId, channelId);

    // Mark as completed
    db.prepare(`
      UPDATE videos
      SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, is_manually_queued = 0, last_error = null, retry_count = 0
      WHERE id = ?
    `).run(videoId);
    addLog(`Téléchargement RÉUSSI : "${videoTitle}"`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    addLog(`ÉCHEC du téléchargement pour la vidéo "${videoTitle}" (${videoId}) : ${errMsg}`);

    // Check if the download was interrupted intentionally (e.g. paused/cancelled via API or global paused setting)
    const currentVideo = db.prepare('SELECT download_status, retry_count FROM videos WHERE id = ?').get(videoId) as { download_status: string; retry_count: number | null } | undefined;
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
    const isPausedGlobal = pausedSetting?.value === '1';

    if (isPausedGlobal || currentVideo?.download_status === 'pending') {
      addLog(`Téléchargement de la vidéo "${videoTitle}" (${videoId}) interrompu ou mis en pause intentionnellement.`);
      // Ensure status is pending, speed/eta are null, but preserve progress and files.
      // This is a deliberate interruption, not a genuine failure — retry_count is untouched.
      db.prepare(`
        UPDATE videos
        SET download_status = 'pending', download_speed = null, download_eta = null
        WHERE id = ?
      `).run(videoId);
    } else {
      const nextRetryCount = (currentVideo?.retry_count ?? 0) + 1;
      if (nextRetryCount >= MAX_RETRY_COUNT) {
        // Exhausted retries — mark failed and stop consuming queue turns. Not requeued
        // (created_at is not bumped), so the queue worker's `WHERE download_status = 'pending'`
        // query will never pick this row up again until an explicit retry-failed request.
        db.prepare(`
          UPDATE videos
          SET download_status = 'failed', download_progress = 0, download_speed = null, download_eta = null, is_manually_queued = 0, last_error = ?, retry_count = ?
          WHERE id = ?
        `).run(errMsg, nextRetryCount, videoId);
        addLog(`Vidéo "${videoTitle}" (${videoId}) marquée comme définitivement échouée après ${nextRetryCount} tentatives.`);
      } else {
        // Put the video back to pending but move it to the end of the queue by updating created_at
        db.prepare(`
          UPDATE videos
          SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, is_manually_queued = 0, last_error = ?, created_at = ?, retry_count = ?
          WHERE id = ?
        `).run(errMsg, Date.now(), nextRetryCount, videoId);
      }
    }
    // Brief pause so a rapidly-failing video isn't immediately re-picked; scoped to this
    // video's own task so it doesn't block the orchestrator or other concurrent downloads.
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    decrementActiveDownloadCount();
    // Wake the orchestrator in case it's sleeping on a "no capacity" or "no work" check
    wakeWorker();
  }
}
```

- [ ] **Step 2: Manual verification**

This function has zero automated test coverage (consistent with every prior sub-project touching this file) — verify manually instead:

1. Start the dev server (`npm run dev`).
2. Queue a video with a URL that will reliably fail every time (e.g. a known-deleted YouTube video id).
3. Watch it retry: confirm in the DB (`sqlite3 data/youkeep.db "SELECT id, download_status, retry_count, last_error FROM videos WHERE id = '<videoId>';"`) that `retry_count` increments (1, then 2) and `download_status` stays `pending` after the first two failures.
4. After the 3rd failure, confirm `download_status` becomes `failed` and `retry_count = 3`, and that the video is NOT picked up again by the queue worker (it stays at `failed`, doesn't flip back to `pending`/`downloading`).
5. Confirm a video that succeeds on its first attempt has `retry_count = 0` and `download_status = 'completed'`.
6. Confirm the deliberate-pause path still works correctly: queue a video, pause it mid-download via the admin UI, confirm it goes to `pending` with progress/files preserved and `retry_count` is NOT incremented by this pause.

Report what you observed, including the exact `retry_count`/`download_status` progression you saw.

- [ ] **Step 3: Commit**

```bash
git add server/utils/downloader.ts
git commit -m "feat: cap video download retries at 3 attempts before marking failed"
```

---

### Task 4: Guarantee `downloadMusicTrackFile()` always settles, and cleans up on every failure

**Files:**
- Modify: `server/utils/musicDownloader.ts` (the `downloadMusicTrackFile` function's `child.on('error', ...)` handler and `child.on('close', ...)` handler)

**Interfaces:**
- Consumes: nothing from earlier tasks directly.
- Produces: a `downloadMusicTrackFile()` promise guaranteed to settle on every exit path, with cleanup on every failure. Task 5 (`runSingleMusicDownload`'s catch block) relies on this.

- [ ] **Step 1: Add cleanup to the `error` handler**

The handler currently reads:

```ts
      child.on('error', (err) => {
        clearTimeout(watchdog);
        addLog(`yt-dlp [${trackId}] process error : ${err.message || err}`);
        activeMusicProcesses.delete(trackId);
        activeMusicDownloadStartTimes.delete(trackId);
        settle(() => reject(err));
      });
```

Add a `cleanupPartialMusicFiles(trackId, artistId)` call before the `settle(...)` line:

```ts
      child.on('error', (err) => {
        clearTimeout(watchdog);
        addLog(`yt-dlp [${trackId}] process error : ${err.message || err}`);
        activeMusicProcesses.delete(trackId);
        activeMusicDownloadStartTimes.delete(trackId);
        cleanupPartialMusicFiles(trackId, artistId);
        settle(() => reject(err));
      });
```

- [ ] **Step 2: Wrap the success-path DB writes in try/catch, and add cleanup to the non-zero-exit-code branch**

The `close` handler's success branch currently ends with (after locating files and parsing the info.json):

```ts
          const fileSize = audioFile && fs.existsSync(audioFile) ? fs.statSync(audioFile).size : null;

          db.prepare(`
            UPDATE music_tracks
            SET local_file_path = ?, local_thumbnail_path = ?, album_id = COALESCE(?, album_id),
                genre = COALESCE(?, genre), track_number = COALESCE(?, track_number), size_bytes = ?, has_clip = ?
            WHERE id = ?
          `).run(localFilePath, thumbnailUrlPath, albumId, genre, trackNumber, fileSize, wantClip ? 1 : 0, trackId);

          db.prepare(`
            INSERT INTO music_track_artists (track_id, artist_id, role)
            VALUES (?, ?, 'primary')
            ON CONFLICT(track_id, artist_id) DO NOTHING
          `).run(trackId, artistId);

          settle(() => resolve({ hasClip: wantClip }));
        } else {
          const errorMsg = lastStderr ? `yt-dlp a échoué (code ${code}) : ${lastStderr}` : `yt-dlp a échoué avec le code ${code}`;
          settle(() => reject(new Error(errorMsg)));
        }
      });
```

Replace it with:

```ts
          const fileSize = audioFile && fs.existsSync(audioFile) ? fs.statSync(audioFile).size : null;

          try {
            db.prepare(`
              UPDATE music_tracks
              SET local_file_path = ?, local_thumbnail_path = ?, album_id = COALESCE(?, album_id),
                  genre = COALESCE(?, genre), track_number = COALESCE(?, track_number), size_bytes = ?, has_clip = ?
              WHERE id = ?
            `).run(localFilePath, thumbnailUrlPath, albumId, genre, trackNumber, fileSize, wantClip ? 1 : 0, trackId);

            db.prepare(`
              INSERT INTO music_track_artists (track_id, artist_id, role)
              VALUES (?, ?, 'primary')
              ON CONFLICT(track_id, artist_id) DO NOTHING
            `).run(trackId, artistId);

            settle(() => resolve({ hasClip: wantClip }));
          } catch (dbErr: any) {
            // The audio/thumbnail files downloaded successfully, but the DB write that
            // records them failed. Treat this identically to an ordinary yt-dlp failure —
            // same rejection, no file cleanup here (the download itself was fine) — so the
            // promise always settles instead of hanging forever.
            settle(() => reject(dbErr));
          }
        } else {
          const errorMsg = lastStderr ? `yt-dlp a échoué (code ${code}) : ${lastStderr}` : `yt-dlp a échoué avec le code ${code}`;
          cleanupPartialMusicFiles(trackId, artistId);
          settle(() => reject(new Error(errorMsg)));
        }
      });
```

- [ ] **Step 3: Manual verification**

This function has zero automated test coverage — verify manually instead:

1. Start the dev server (`npm run dev`).
2. Queue a music track with a URL/id that will reliably fail.
3. Confirm the failure is logged and `download_status` returns to `pending` (not stuck at `downloading`).
4. Confirm no partial audio fragment files are left in the artist's download directory after the failure.
5. Queue a normal, working track and confirm it still downloads and completes successfully.

Report what you observed.

- [ ] **Step 4: Commit**

```bash
git add server/utils/musicDownloader.ts
git commit -m "fix: guarantee downloadMusicTrackFile always settles and cleans up on every failure"
```

---

### Task 5: `retry_count` and `'failed'` status in `runSingleMusicDownload()`

**Files:**
- Modify: `server/utils/musicDownloader.ts` (the `runSingleMusicDownload` function)

**Interfaces:**
- Consumes: `music_tracks.retry_count` column from Task 1; relies on Task 4's always-settle guarantee.
- Produces: after this task, a track that fails 3 times in a row lands on `download_status = 'failed'`. Task 7 (new music `retry-failed.post.ts`) resets `retry_count` back to 0.

- [ ] **Step 1: Add `retry_count` handling**

The function currently reads in full:

```ts
async function runSingleMusicDownload(trackId: string, trackTitle: string, artistId: string): Promise<void> {
  const db = getDb();
  try {
    const clipsSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string } | undefined;
    const wantClip = clipsSetting?.value === '1';

    let result: { hasClip: boolean };
    let clipFallbackError: string | null = null;
    if (wantClip) {
      try {
        result = await downloadMusicTrackFile(trackId, artistId, { wantClip: true });
      } catch (clipErr: any) {
        clipFallbackError = clipErr.message || String(clipErr);
        addLog(`Échec du téléchargement du clip pour "${trackTitle}" (${trackId}), repli sur l'audio seul : ${clipFallbackError}`);

        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
        const currentTrackState = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get(trackId) as { download_status: string } | undefined;
        if (pausedSetting?.value === '1' || currentTrackState?.download_status !== 'downloading') {
          // A pause deliberately preserves partial files for resume (see pause.post.ts's
          // keepProgressAndFiles=true) — a cancel already cleans up via cancelMusicDownload.
          // Only clean up here when we're actually about to retry below.
          throw clipErr;
        }

        // No newerThan guard here (unlike other cleanup call sites in this file): this is the
        // automatic ingestion queue path, which only ever downloads fresh tracks — there is no
        // pre-existing file this attempt could clobber, so a start-time guard has nothing to protect.
        cleanupPartialMusicFiles(trackId, artistId);
        result = await downloadMusicTrackFile(trackId, artistId, { wantClip: false });
      }
    } else {
      result = await downloadMusicTrackFile(trackId, artistId, { wantClip: false });
    }

    db.prepare(`
      UPDATE music_tracks
      SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, last_error = ?
      WHERE id = ?
    `).run(clipFallbackError ? `Clip indisponible, repli sur l'audio seul : ${clipFallbackError}` : null, trackId);
    addLog(`Téléchargement ${result.hasClip ? 'du clip' : 'audio'} RÉUSSI : "${trackTitle}"`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    addLog(`ÉCHEC du téléchargement pour la track "${trackTitle}" (${trackId}) : ${errMsg}`);

    const currentTrack = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get(trackId) as { download_status: string } | undefined;
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
    const isPausedGlobal = pausedSetting?.value === '1';

    if (isPausedGlobal || currentTrack?.download_status === 'pending') {
      addLog(`Téléchargement de la track "${trackTitle}" (${trackId}) interrompu ou mis en pause intentionnellement.`);
      db.prepare(`
        UPDATE music_tracks
        SET download_status = 'pending', download_speed = null, download_eta = null
        WHERE id = ?
      `).run(trackId);
    } else {
      db.prepare(`
        UPDATE music_tracks
        SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, created_at = ?
        WHERE id = ?
      `).run(errMsg, Date.now(), trackId);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    decrementActiveMusicDownloadCount();
    wakeMusicWorker();
  }
}
```

Replace the whole function body with:

```ts
async function runSingleMusicDownload(trackId: string, trackTitle: string, artistId: string): Promise<void> {
  const db = getDb();
  const MAX_RETRY_COUNT = 3;
  try {
    const clipsSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string } | undefined;
    const wantClip = clipsSetting?.value === '1';

    let result: { hasClip: boolean };
    let clipFallbackError: string | null = null;
    if (wantClip) {
      try {
        result = await downloadMusicTrackFile(trackId, artistId, { wantClip: true });
      } catch (clipErr: any) {
        clipFallbackError = clipErr.message || String(clipErr);
        addLog(`Échec du téléchargement du clip pour "${trackTitle}" (${trackId}), repli sur l'audio seul : ${clipFallbackError}`);

        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
        const currentTrackState = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get(trackId) as { download_status: string } | undefined;
        if (pausedSetting?.value === '1' || currentTrackState?.download_status !== 'downloading') {
          // A pause deliberately preserves partial files for resume (see pause.post.ts's
          // keepProgressAndFiles=true) — a cancel already cleans up via cancelMusicDownload.
          // Only clean up here when we're actually about to retry below.
          throw clipErr;
        }

        // No newerThan guard here (unlike other cleanup call sites in this file): this is the
        // automatic ingestion queue path, which only ever downloads fresh tracks — there is no
        // pre-existing file this attempt could clobber, so a start-time guard has nothing to protect.
        cleanupPartialMusicFiles(trackId, artistId);
        result = await downloadMusicTrackFile(trackId, artistId, { wantClip: false });
      }
    } else {
      result = await downloadMusicTrackFile(trackId, artistId, { wantClip: false });
    }

    db.prepare(`
      UPDATE music_tracks
      SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, last_error = ?, retry_count = 0
      WHERE id = ?
    `).run(clipFallbackError ? `Clip indisponible, repli sur l'audio seul : ${clipFallbackError}` : null, trackId);
    addLog(`Téléchargement ${result.hasClip ? 'du clip' : 'audio'} RÉUSSI : "${trackTitle}"`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    addLog(`ÉCHEC du téléchargement pour la track "${trackTitle}" (${trackId}) : ${errMsg}`);

    const currentTrack = db.prepare('SELECT download_status, retry_count FROM music_tracks WHERE id = ?').get(trackId) as { download_status: string; retry_count: number | null } | undefined;
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
    const isPausedGlobal = pausedSetting?.value === '1';

    if (isPausedGlobal || currentTrack?.download_status === 'pending') {
      addLog(`Téléchargement de la track "${trackTitle}" (${trackId}) interrompu ou mis en pause intentionnellement.`);
      // Deliberate interruption, not a genuine failure — retry_count is untouched.
      db.prepare(`
        UPDATE music_tracks
        SET download_status = 'pending', download_speed = null, download_eta = null
        WHERE id = ?
      `).run(trackId);
    } else {
      const nextRetryCount = (currentTrack?.retry_count ?? 0) + 1;
      if (nextRetryCount >= MAX_RETRY_COUNT) {
        db.prepare(`
          UPDATE music_tracks
          SET download_status = 'failed', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, retry_count = ?
          WHERE id = ?
        `).run(errMsg, nextRetryCount, trackId);
        addLog(`Track "${trackTitle}" (${trackId}) marquée comme définitivement échouée après ${nextRetryCount} tentatives.`);
      } else {
        db.prepare(`
          UPDATE music_tracks
          SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, created_at = ?, retry_count = ?
          WHERE id = ?
        `).run(errMsg, Date.now(), nextRetryCount, trackId);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    decrementActiveMusicDownloadCount();
    wakeMusicWorker();
  }
}
```

Note: the clip-fallback branching above this point (the `if (wantClip) { try { ... } catch (clipErr) { ... } }` block) is unchanged — a clip failure that successfully falls back to audio-only still reaches the success `UPDATE` at the bottom (with `retry_count = 0`), and a clip failure that re-throws (paused/cancelled) flows into the same outer `catch` block as any other failure, so it's correctly covered by the same retry/failed logic without any special-casing needed.

- [ ] **Step 2: Manual verification**

This function has zero automated test coverage — verify manually instead:

1. Start the dev server (`npm run dev`).
2. Queue a music track with an id that will reliably fail every time.
3. Confirm in the DB (`sqlite3 data/youkeep.db "SELECT id, download_status, retry_count, last_error FROM music_tracks WHERE id = '<trackId>';"`) that `retry_count` increments and `download_status` stays `pending` for the first two failures, then becomes `failed` with `retry_count = 3` after the third.
4. Confirm the track is not picked up again by the music queue worker once `failed`.
5. Confirm a track that succeeds has `retry_count = 0` and `download_status = 'completed'`.

Report what you observed, including the exact `retry_count`/`download_status` progression.

- [ ] **Step 3: Commit**

```bash
git add server/utils/musicDownloader.ts
git commit -m "feat: cap music track download retries at 3 attempts before marking failed"
```

---

### Task 6: Reset `retry_count` in the video retry-failed endpoint

**Files:**
- Modify: `server/api/admin/downloader/retry-failed.post.ts`
- Test: `tests/integration/downloader-retry-failed.test.ts` (new)

**Interfaces:**
- Consumes: `videos.retry_count` column from Task 1.
- Produces: nothing consumed by later tasks (Task 7 is a new, separate file, not dependent on this one's exports).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/downloader-retry-failed.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import retryFailedHandler from '../../server/api/admin/downloader/retry-failed.post';
import * as downloader from '../../server/utils/downloader';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertChannel,
  insertVideo,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  vi.restoreAllMocks();
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('POST /api/admin/downloader/retry-failed', () => {
  it('returns 401 for a guest', async () => {
    await expect(retryFailedHandler(mockEvent(undefined, { path: '/api/admin/downloader/retry-failed', body: {} }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs('u1', 'user');
    await expect(retryFailedHandler(mockEvent(cookie, { path: '/api/admin/downloader/retry-failed', body: {} }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('resets a single failed video to pending with retry_count reset to 0', async () => {
    vi.spyOn(downloader, 'startQueueWorker').mockImplementation(async () => {});
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'failed' });
    db.prepare('UPDATE videos SET retry_count = 3, last_error = ? WHERE id = ?').run('some error', 'v1');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/downloader/retry-failed', body: { videoId: 'v1' } }));

    const row = db.prepare('SELECT download_status, retry_count, last_error FROM videos WHERE id = ?').get('v1') as any;
    expect(row.download_status).toBe('pending');
    expect(row.retry_count).toBe(0);
    expect(row.last_error).toBeNull();
  });

  it('does not touch a video that is not failed', async () => {
    vi.spyOn(downloader, 'startQueueWorker').mockImplementation(async () => {});
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'completed' });
    db.prepare('UPDATE videos SET retry_count = 0 WHERE id = ?').run('v1');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/downloader/retry-failed', body: { videoId: 'v1' } }));

    const row = db.prepare('SELECT download_status FROM videos WHERE id = ?').get('v1') as any;
    expect(row.download_status).toBe('completed');
  });

  it('resets all failed videos to pending with retry_count reset to 0 when no videoId is given', async () => {
    vi.spyOn(downloader, 'startQueueWorker').mockImplementation(async () => {});
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'failed' });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'failed' });
    insertVideo(db, { id: 'v3', channelId: 'c1', downloadStatus: 'completed' });
    db.prepare('UPDATE videos SET retry_count = 3 WHERE id IN (?, ?)').run('v1', 'v2');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/downloader/retry-failed', body: {} }));

    const v1 = db.prepare('SELECT download_status, retry_count FROM videos WHERE id = ?').get('v1') as any;
    const v2 = db.prepare('SELECT download_status, retry_count FROM videos WHERE id = ?').get('v2') as any;
    const v3 = db.prepare('SELECT download_status FROM videos WHERE id = ?').get('v3') as any;
    expect(v1.download_status).toBe('pending');
    expect(v1.retry_count).toBe(0);
    expect(v2.download_status).toBe('pending');
    expect(v2.retry_count).toBe(0);
    expect(v3.download_status).toBe('completed');
  });
});
```

If `insertVideo` in `tests/helpers/testDb.ts` doesn't accept a `downloadStatus` option, check its actual signature first (read the helper) and adapt the test's calls to match — set the status via a follow-up `db.prepare('UPDATE videos SET download_status = ? WHERE id = ?').run(...)` call instead if needed, rather than assuming the helper's exact parameter names.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/downloader-retry-failed.test.ts`
Expected: the two "reset" tests FAIL (retry_count stays 3, not 0) since the endpoint doesn't reset it yet; the 401/403/not-failed tests should already PASS since they don't depend on this task's change.

- [ ] **Step 3: Add `retry_count = 0` to both UPDATE statements**

`server/api/admin/downloader/retry-failed.post.ts` currently reads:

```ts
import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  const body = await readBody(event);

  if (body?.videoId) {
    // Retry a single video
    db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL
      WHERE id = ? AND download_status = 'failed'
    `).run(body.videoId);
  } else {
    // Retry all failed downloads
    db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL
      WHERE download_status = 'failed'
    `).run();
  }

  // Trigger queue processing
  startQueueWorker();

  return { success: true };
});
```

Change both `SET` clauses to add `retry_count = 0`:

```ts
import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  const body = await readBody(event);

  if (body?.videoId) {
    // Retry a single video
    db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
      WHERE id = ? AND download_status = 'failed'
    `).run(body.videoId);
  } else {
    // Retry all failed downloads
    db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
      WHERE download_status = 'failed'
    `).run();
  }

  // Trigger queue processing
  startQueueWorker();

  return { success: true };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/downloader-retry-failed.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test -- --run`
Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/api/admin/downloader/retry-failed.post.ts tests/integration/downloader-retry-failed.test.ts
git commit -m "fix: reset retry_count when manually retrying a failed video"
```

---

### Task 7: New music retry-failed endpoint

**Files:**
- Create: `server/api/admin/music/retry-failed.post.ts`
- Test: `tests/integration/music-retry-failed.test.ts` (new)

**Interfaces:**
- Consumes: `music_tracks.retry_count` column from Task 1; `startMusicQueueWorker()` exported from `server/utils/musicDownloader.ts`.
- Produces: `POST /api/admin/music/retry-failed` — accepts an optional `trackId` in the body (single-track retry) or retries all failed tracks. Consumed by Task 8's new UI button.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-retry-failed.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import retryFailedHandler from '../../server/api/admin/music/retry-failed.post';
import * as musicDownloader from '../../server/utils/musicDownloader';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  vi.restoreAllMocks();
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('POST /api/admin/music/retry-failed', () => {
  it('returns 401 for a guest', async () => {
    await expect(retryFailedHandler(mockEvent(undefined, { path: '/api/admin/music/retry-failed', body: {} }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs('u1', 'user');
    await expect(retryFailedHandler(mockEvent(cookie, { path: '/api/admin/music/retry-failed', body: {} }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('resets a single failed track to pending with retry_count reset to 0', async () => {
    vi.spyOn(musicDownloader, 'startMusicQueueWorker').mockImplementation(async () => {});
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'failed' });
    db.prepare('UPDATE music_tracks SET retry_count = 3, last_error = ? WHERE id = ?').run('some error', 't1');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/music/retry-failed', body: { trackId: 't1' } }));

    const row = db.prepare('SELECT download_status, retry_count, last_error FROM music_tracks WHERE id = ?').get('t1') as any;
    expect(row.download_status).toBe('pending');
    expect(row.retry_count).toBe(0);
    expect(row.last_error).toBeNull();
  });

  it('does not touch a track that is not failed', async () => {
    vi.spyOn(musicDownloader, 'startMusicQueueWorker').mockImplementation(async () => {});
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'completed' });

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/music/retry-failed', body: { trackId: 't1' } }));

    const row = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get('t1') as any;
    expect(row.download_status).toBe('completed');
  });

  it('resets all failed tracks to pending with retry_count reset to 0 when no trackId is given', async () => {
    vi.spyOn(musicDownloader, 'startMusicQueueWorker').mockImplementation(async () => {});
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', downloadStatus: 'completed' });
    db.prepare('UPDATE music_tracks SET retry_count = 3 WHERE id IN (?, ?)').run('t1', 't2');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/music/retry-failed', body: {} }));

    const t1 = db.prepare('SELECT download_status, retry_count FROM music_tracks WHERE id = ?').get('t1') as any;
    const t2 = db.prepare('SELECT download_status, retry_count FROM music_tracks WHERE id = ?').get('t2') as any;
    const t3 = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get('t3') as any;
    expect(t1.download_status).toBe('pending');
    expect(t1.retry_count).toBe(0);
    expect(t2.download_status).toBe('pending');
    expect(t2.retry_count).toBe(0);
    expect(t3.download_status).toBe('completed');
  });
});
```

If `insertMusicTrack` doesn't accept a `downloadStatus` option, check its actual signature first (read `tests/helpers/testDb.ts`) and adapt — this helper is already used with a `downloadStatus` field in `tests/integration/music-playlists.test.ts`'s `excludes tracks that are not completed` test, so it should already support it; confirm before assuming.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-retry-failed.test.ts`
Expected: FAIL — `Cannot find module '../../server/api/admin/music/retry-failed.post'` (the endpoint doesn't exist yet).

- [ ] **Step 3: Create the endpoint**

Create `server/api/admin/music/retry-failed.post.ts`, mirroring the (now-updated, per Task 6) video version exactly, adapted for `music_tracks`/`startMusicQueueWorker`:

```ts
import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  const body = await readBody(event);

  if (body?.trackId) {
    // Retry a single track
    db.prepare(`
      UPDATE music_tracks 
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
      WHERE id = ? AND download_status = 'failed'
    `).run(body.trackId);
  } else {
    // Retry all failed downloads
    db.prepare(`
      UPDATE music_tracks 
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
      WHERE download_status = 'failed'
    `).run();
  }

  // Trigger queue processing
  startMusicQueueWorker();

  return { success: true };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-retry-failed.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test -- --run`
Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/api/admin/music/retry-failed.post.ts tests/integration/music-retry-failed.test.ts
git commit -m "feat: add music retry-failed endpoint"
```

---

### Task 8: "Retry N Failed" button for the music panel

**Files:**
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes: `POST /api/admin/music/retry-failed` from Task 7.

- [ ] **Step 1: Add a `retryingMusicFailed` ref**

The script section already declares (search for `musicFailedCount`, around the "2. DOWNLOADS TAB" / music state block):

```ts
const musicFailedCount = ref(0);
```

Add a new ref right after it:

```ts
const musicFailedCount = ref(0);
const retryingMusicFailed = ref(false);
```

- [ ] **Step 2: Add the button to the music panel's actions row**

The music panel's `.queue-actions-row` currently reads:

```html
            <div class="queue-actions-row">
              <button
                @click="toggleMusicPause"
                class="btn"
                :class="musicIsPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
                :disabled="pausingOrResumingMusic"
              >
                <svg v-if="musicIsPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                <span>{{ musicIsPaused ? 'Resume Music Sync' : 'Pause Music Sync' }}</span>
              </button>

              <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
                <label for="max-concurrent-music-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
                <input
                  id="max-concurrent-music-downloads"
                  type="number"
                  min="1"
                  v-model.number="maxConcurrentMusicDownloads"
                  class="form-input"
                  style="width: 64px;"
                />
                <button @click="handleSaveMusicConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingMusicConcurrency">
                  {{ savingMusicConcurrency ? 'Saving...' : 'Save' }}
                </button>
              </div>
            </div>
```

Add the "Retry N Failed" button after the concurrency control div, mirroring the video panel's button exactly (same SVG, same conditional pattern):

```html
            <div class="queue-actions-row">
              <button
                @click="toggleMusicPause"
                class="btn"
                :class="musicIsPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
                :disabled="pausingOrResumingMusic"
              >
                <svg v-if="musicIsPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                <span>{{ musicIsPaused ? 'Resume Music Sync' : 'Pause Music Sync' }}</span>
              </button>

              <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
                <label for="max-concurrent-music-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
                <input
                  id="max-concurrent-music-downloads"
                  type="number"
                  min="1"
                  v-model.number="maxConcurrentMusicDownloads"
                  class="form-input"
                  style="width: 64px;"
                />
                <button @click="handleSaveMusicConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingMusicConcurrency">
                  {{ savingMusicConcurrency ? 'Saving...' : 'Save' }}
                </button>
              </div>

              <button v-if="musicFailedCount > 0" @click="handleRetryAllMusicFailed" class="btn btn-secondary-dark" :disabled="retryingMusicFailed">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
                <span>Retry {{ musicFailedCount }} Failed</span>
              </button>
            </div>
```

- [ ] **Step 3: Add the `handleRetryAllMusicFailed` function**

The script already has `handleRetryAllFailed` (search for it) to mirror:

```ts
const handleRetryAllFailed = async () => {
  retryingFailed.value = true;
  try {
    await $fetch('/api/admin/downloader/retry-failed', { method: 'POST' });
    fetchQueue();
    toast.success('Failed downloads retried.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  } finally {
    retryingFailed.value = false;
  }
};
```

Add a new function right after it, calling the music endpoint and refreshing the music queue instead:

```ts
const handleRetryAllMusicFailed = async () => {
  retryingMusicFailed.value = true;
  try {
    await $fetch('/api/admin/music/retry-failed', { method: 'POST' });
    fetchMusicQueue();
    toast.success('Failed downloads retried.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  } finally {
    retryingMusicFailed.value = false;
  }
};
```

- [ ] **Step 4: Manual verification**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server (`npm run dev`).
2. Using a track that's been driven to `download_status = 'failed'` via Task 5's manual verification (or by directly setting it in the DB for a quick UI check: `sqlite3 data/youkeep.db "UPDATE music_tracks SET download_status = 'failed', retry_count = 3, last_error = 'test' WHERE id = '<trackId>';"`), reload the Settings page's Music Ingestion panel.
3. Confirm the "Retry N Failed" button appears with the correct count.
4. Click it. Confirm the track's `download_status` returns to `pending` in the DB, `retry_count` resets to 0, and the button disappears once no failed tracks remain (queue refetch reflects the change).
5. Confirm the existing per-track error box (`v-if="track.download_status === 'failed' && track.last_error"`) renders correctly for a failed track before you retry it.

Report what you observed.

- [ ] **Step 5: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: add Retry N Failed button for the music download queue"
```
