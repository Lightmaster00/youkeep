# Reliability Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 independent, small Important-severity bugs from the project audit backlog: missing DB indexes, a timer leak in the video watch page, and a dead-code message bug in single-video ingestion.

**Architecture:** Three fully independent, single-file changes with no shared interfaces. Each is its own task.

**Tech Stack:** Nuxt 4, Nitro (H3), better-sqlite3, Vue 3 Composition API, yt-dlp.

## Global Constraints

- No fix for the admin error-message-leakage audit finding — explicitly deferred to the backlog per user decision.
- No changes to `ingestUrl()`'s Case A (playlist branch) — its equivalent bug was already fixed in an earlier sub-project.

---

### Task 1: Add missing DB indexes

**Files:**
- Modify: `server/utils/db.ts:290-298`

**Interfaces:**
- Produces: nothing consumed by later tasks — fully independent.

- [ ] **Step 1: Add the 4 new indexes**

The existing index block currently reads (lines 290-298):

```ts
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_download_status ON videos(download_status);
    CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_personal_playlist_videos_playlist_id ON personal_playlist_videos(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_music_play_history_user_track ON music_play_history(user_id, track_id);
  `);
```

Add 4 new lines before the closing backtick:

```ts
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_download_status ON videos(download_status);
    CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_personal_playlist_videos_playlist_id ON personal_playlist_videos(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_music_play_history_user_track ON music_play_history(user_id, track_id);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_artist_id ON music_tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_album_id ON music_tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);
    CREATE INDEX IF NOT EXISTS idx_video_chapters_video_id ON video_chapters(video_id);
  `);
```

- [ ] **Step 2: Run the test suite**

Run: `npm test -- --run`
Expected: all tests pass, no regressions (purely additive schema change — SQLite index presence doesn't change query results, only performance).

- [ ] **Step 3: Commit**

```bash
git add server/utils/db.ts
git commit -m "perf: add missing indexes on music_tracks, comments, and video_chapters"
```

---

### Task 2: Fix the un-cleared auto-advance timer in `watch/[id].vue`

**Files:**
- Modify: `app/pages/watch/[id].vue`

**Interfaces:**
- Produces: nothing consumed by later tasks — fully independent.

- [ ] **Step 1: Declare the timer variable**

Find the script section's top-level state declarations (near other `let`/`ref` declarations — search for an existing module-scoped `let` such as `let observer` in other files' patterns, or simply add near the top of the `<script setup>` block, close to where other plain `let` variables for this component are declared if any exist; if none exist, add it directly above `handleVideoEnded` for locality):

```ts
let autoNextTimer: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 2: Store the timer handle in `handleVideoEnded()`**

The function currently reads (lines 490-503):

```ts
const handleVideoEnded = () => {
  if (playlistId.value && playlistVideos.value.length > 0) {
    const currentIndex = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
    if (currentIndex >= 0 && currentIndex < playlistVideos.value.length - 1) {
      const nextVideo = playlistVideos.value[currentIndex + 1];
      if (nextVideo.download_status === 'completed') {
        toast.info(`Lecture de la vidéo suivante : ${nextVideo.title}`);
        setTimeout(() => {
          navigateTo(`/watch/${nextVideo.id}?playlistId=${playlistId.value}`);
        }, 1500);
      }
    }
  }
};
```

Change it to store the handle:

```ts
const handleVideoEnded = () => {
  if (playlistId.value && playlistVideos.value.length > 0) {
    const currentIndex = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
    if (currentIndex >= 0 && currentIndex < playlistVideos.value.length - 1) {
      const nextVideo = playlistVideos.value[currentIndex + 1];
      if (nextVideo.download_status === 'completed') {
        toast.info(`Lecture de la vidéo suivante : ${nextVideo.title}`);
        autoNextTimer = setTimeout(() => {
          autoNextTimer = null;
          navigateTo(`/watch/${nextVideo.id}?playlistId=${playlistId.value}`);
        }, 1500);
      }
    }
  }
};
```

(Setting `autoNextTimer = null` inside the callback itself, right before navigating, means a later clear attempt against an already-fired timer is a harmless no-op — `clearTimeout` on a stale numeric handle that already fired does nothing, but nulling it out keeps the variable's state accurate.)

- [ ] **Step 3: Clear the timer when the video changes**

The existing watcher currently reads (lines 520-523):

```ts
// Collapse the description when navigating to a different video
watch(videoId, () => {
  descriptionExpanded.value = false;
});
```

Add the clear at the start of the callback:

```ts
// Collapse the description when navigating to a different video
watch(videoId, () => {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  descriptionExpanded.value = false;
});
```

This is the fix that actually closes the described bug: `videoId` changes on every navigation to a different video, whether triggered by the auto-advance itself or by the user manually clicking something else — so this watcher reliably fires before any stale timer could act on outdated state.

- [ ] **Step 4: Clear the timer on unmount, as defense in depth**

The existing `onUnmounted` block near the same area currently reads (lines 516-518):

```ts
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
});
```

Add the same clear:

```ts
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
});
```

(There is a second, unrelated `onUnmounted` block later in the file, around line 738, for a scroll listener tied to the mini-player — do not touch that one, it has nothing to do with this timer.)

- [ ] **Step 5: Manual verification**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server (`npm run dev`).
2. Open a playlist with at least 2 completed videos, play the first one, and let it play to the end (or seek near the end and let it finish) so `handleVideoEnded` fires and the "next video" toast countdown starts.
3. Before the 1.5s countdown elapses, click a different video (e.g. from a "related videos" list, or navigate to a completely different video via search/browse).
4. Confirm the manually-selected video plays — the page does NOT get force-navigated to the original auto-advance target a moment later.
5. As a regression check, confirm normal auto-advance still works when nothing interrupts it: let a playlist video finish without any manual navigation, confirm it still auto-advances to the next video after ~1.5s as before.

Report what you observed.

- [ ] **Step 6: Commit**

```bash
git add app/pages/watch/[id].vue
git commit -m "fix: clear auto-advance timer when navigating away from a playlist video"
```

---

### Task 3: Fix `ingestUrl()`'s single-video dead-code message bug

**Files:**
- Modify: `server/utils/downloader.ts` (Case B, single-video ingestion branch)

**Interfaces:**
- Produces: nothing consumed by later tasks — fully independent.

- [ ] **Step 1: Add a pre-upsert status check**

Case B currently reads (lines 1448-1494):

```ts
  // Case B: It's a single video
  const videoId = data.id;
  const channelId = data.channel_id || 'unknown-channel';
  const channelTitle = data.channel || 'Unknown Channel';

  ensureChannelExists(db, channelId, channelTitle);

  // Insert or update video
  const isShortFlag = (
    url.includes('/shorts/') || 
    (data.webpage_url && data.webpage_url.includes('/shorts/')) || 
    (data.original_url && data.original_url.includes('/shorts/'))
  ) ? 1 : 0;

  const res = db.prepare(`
    INSERT INTO videos (id, title, description, channel_id, upload_date, duration, view_count, download_status, is_manually_queued, is_short, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      download_status = CASE WHEN download_status != 'completed' THEN 'pending' ELSE download_status END,
      is_manually_queued = CASE WHEN download_status != 'completed' THEN 1 ELSE is_manually_queued END,
      is_short = excluded.is_short
  `).run(
    videoId,
    data.title || `Video ${videoId}`,
    data.description || '',
    channelId,
    data.upload_date || null,
    data.duration || null,
    data.view_count || null,
    isShortFlag,
    Date.now()
  );

  // Trigger queue processing unconditionally since this is a manual ingest
  startQueueWorker();

  if (res.changes > 0) {
    return { success: true, message: `Video "${data.title}" has been added to the download queue.`, count: 1 };
  } else {
    const videoStatus = db.prepare('SELECT download_status FROM videos WHERE id = ?').get(videoId) as { download_status: string } | undefined;
    if (videoStatus?.download_status === 'completed') {
      return { success: true, message: `Video "${data.title}" is already present in the archive.`, count: 0 };
    } else {
      return { success: true, message: `Video "${data.title}" has been re-added to the download queue.`, count: 1 };
    }
  }
}
```

This has the same `res.changes > 0` trap already fixed for playlist ingestion elsewhere in this file: `res.changes` from `INSERT ... ON CONFLICT DO UPDATE` is always truthy whenever the row already exists (SQLite counts the UPDATE branch firing as a change regardless of whether any column value actually differs), so the `else` branch (correctly distinguishing "already completed" from "re-added") is unreachable — the `if` branch always wins, always reporting "added to the download queue" / count 1, even for an already-completed video.

Replace the whole block with (mirroring the exact pattern already used in this file's playlist-ingestion branch, which does a pre-upsert `SELECT` to capture prior status before the upsert runs):

```ts
  // Case B: It's a single video
  const videoId = data.id;
  const channelId = data.channel_id || 'unknown-channel';
  const channelTitle = data.channel || 'Unknown Channel';

  ensureChannelExists(db, channelId, channelTitle);

  // Insert or update video
  const isShortFlag = (
    url.includes('/shorts/') || 
    (data.webpage_url && data.webpage_url.includes('/shorts/')) || 
    (data.original_url && data.original_url.includes('/shorts/'))
  ) ? 1 : 0;

  const priorStatus = db.prepare('SELECT download_status FROM videos WHERE id = ?').get(videoId) as { download_status: string } | undefined;

  db.prepare(`
    INSERT INTO videos (id, title, description, channel_id, upload_date, duration, view_count, download_status, is_manually_queued, is_short, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      download_status = CASE WHEN download_status != 'completed' THEN 'pending' ELSE download_status END,
      is_manually_queued = CASE WHEN download_status != 'completed' THEN 1 ELSE is_manually_queued END,
      is_short = excluded.is_short
  `).run(
    videoId,
    data.title || `Video ${videoId}`,
    data.description || '',
    channelId,
    data.upload_date || null,
    data.duration || null,
    data.view_count || null,
    isShortFlag,
    Date.now()
  );

  // Trigger queue processing unconditionally since this is a manual ingest
  startQueueWorker();

  if (!priorStatus) {
    return { success: true, message: `Video "${data.title}" has been added to the download queue.`, count: 1 };
  } else if (priorStatus.download_status === 'completed') {
    return { success: true, message: `Video "${data.title}" is already present in the archive.`, count: 0 };
  } else {
    return { success: true, message: `Video "${data.title}" has been re-added to the download queue.`, count: 1 };
  }
}
```

Note: the `res` variable (the upsert's return value) is no longer needed since the message no longer branches on `res.changes` — it's dropped from the `db.prepare(...).run(...)` assignment (no `const res =`, just a bare statement) since nothing downstream uses it.

- [ ] **Step 2: Manual verification**

`server/utils/downloader.ts` has zero automated test coverage for its yt-dlp-spawning download-execution logic (consistent with every prior sub-project touching this file) — verify manually instead:

1. Start the dev server (`npm run dev`).
2. Find or create a video in the library with `download_status = 'completed'`.
3. Using the admin ingest endpoint or UI, ingest that exact same video's URL again as a single video (not as part of a playlist/channel).
4. Confirm the response message says "already present in the archive" with `count: 0` — not "added to the download queue" with `count: 1`.
5. Ingest a genuinely new video URL (not previously in the library) and confirm it still reports "added to the download queue" / `count: 1` as before.
6. Set a video's `download_status` to `'failed'` (or `'pending'`) and re-ingest its URL — confirm it reports "re-added to the download queue" / `count: 1`.

Report what you observed, including the exact video ids/URLs used and the exact responses seen.

- [ ] **Step 3: Commit**

```bash
git add server/utils/downloader.ts
git commit -m "fix: correct already-archived message for single-video re-ingestion"
```
