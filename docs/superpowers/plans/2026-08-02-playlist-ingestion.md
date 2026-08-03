# YouTube Playlist Download Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin paste a YouTube playlist URL into the existing "Add Channel" field and have every video in it downloaded with correct per-video channel attribution, instead of today's behavior of wrongly treating the playlist as a fake channel.

**Architecture:** A new URL-pattern-based playlist detection branch is inserted into the existing `ingestUrl()` function in `server/utils/downloader.ts`, positioned to intercept before the existing (buggy-for-playlists) "Case A" channel/playlist-conflation branch. It reuses the exact channel-bootstrap logic that single-video ingestion ("Case B") already has — extracted into a small shared helper first, so both call sites stay in sync — and the exact video-upsert shape Case B already uses. No new database tables, no endpoint changes, no UI changes: the existing ingest endpoint already forwards any URL generically to `ingestUrl()`.

**Tech Stack:** Nuxt 4 / Nitro, better-sqlite3, yt-dlp (spawned as a child process).

## Global Constraints

- Every video imported from a playlist gets its own real `channel_id`/`channel` (taken directly from that video's own flat-playlist entry, which yt-dlp already includes — confirmed live in this session against a real playlist), never the playlist's own id/title.
- A channel discovered via playlist import that YouKeep doesn't already know about is created with `sync_status = 'paused'` — a passive reference for correct attribution/display only, never an actively-followed/resyncable channel.
- Playlist-imported videos are queued for download unconditionally (`startQueueWorker()` called regardless of any sync-status check) — this is a deliberate, one-time user action, not a passive subscription.
- No per-video visibility override for playlist-imported videos — this matches single-video ingestion's existing (if imperfect) behavior exactly; do not introduce a new, inconsistent behavior here.
- No new database tables, no new settings, no new endpoint, no UI changes — the existing `POST /api/admin/downloader/ingest` endpoint and the existing "Add Channel" form already forward any pasted URL generically to `ingestUrl()`.
- `server/utils/downloader.ts` has zero automated test coverage for its download-execution logic (it spawns real `yt-dlp` child processes) — this plan does not attempt automated tests for the new playlist branch; verification is manual only. `yt-dlp` is genuinely usable in this sandbox via `data/bin/yt-dlp` with real network access to YouTube for metadata calls — confirmed live in this session against both a real playlist and real video metadata. Attempt manual verification fresh; only skip and report honestly if it turns out unavailable at implementation time, don't assume it is.
- `server/utils/downloader.ts` is a plain utility module with a direct top-level `import { getDb } from './db'` — it does NOT rely on Nitro's ambient auto-import the way `server/api/**` endpoint files do. No explicit-import lessons apply to changes inside this file.

---

### Task 1: Extract `ensureChannelExists` — shared channel-bootstrap helper

**Files:**
- Modify: `server/utils/downloader.ts`

**Interfaces:**
- Consumes: nothing new (uses `getDb`, `addLog`, `ingestUrl` — all already in this file/module scope).
- Produces: `function ensureChannelExists(db: any, channelId: string, channelTitle: string): void` — a private (non-exported) module-level function. Consumed by Task 2, and by the refactored Case B in this same task.

This task is a pure extraction with no behavior change — Case B's existing channel-bootstrap block is moved into a new function, and Case B is updated to call it. The exact same SQL, the exact same retry/logging logic, byte-for-byte.

- [ ] **Step 1: Read the current Case B block to confirm it matches**

Open `server/utils/downloader.ts` and find (search for `// Case B: It's a single video`):

```ts
  // Case B: It's a single video
  const videoId = data.id;
  const channelId = data.channel_id || 'unknown-channel';
  const channelTitle = data.channel || 'Unknown Channel';
  const avatarUrl = null;

  // Ensure channel exists (defaulting single video channels to paused as well, so admins can trigger)
  const channelCheck = db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId);
  if (!channelCheck) {
    db.prepare(`
      INSERT INTO channels (id, title, description, avatar_url, banner_url, sync_status, created_at)
      VALUES (?, ?, ?, ?, ?, 'paused', ?)
      ON CONFLICT(id) DO NOTHING
    `).run(channelId, channelTitle, '', avatarUrl, null, Date.now());

    // Asynchronously fetch full channel details (avatar, banner, description) in background
    // without inserting other videos. Retried a few times since this is a single fire-and-forget
    // request that can otherwise leave the channel with no avatar forever if it hits a transient
    // yt-dlp/network error.
    const retryDelaysMs = [1000, 5000, 15000];
    const fetchChannelDetails = (attempt: number) => {
      setTimeout(async () => {
        try {
          addLog(`Récupération des détails de la nouvelle chaîne "${channelTitle}" (${channelId}), tentative ${attempt + 1}/${retryDelaysMs.length}...`);
          await ingestUrl(`https://www.youtube.com/channel/${channelId}`, { channelMetadataOnly: true });
        } catch (err: any) {
          const nextAttempt = attempt + 1;
          if (nextAttempt < retryDelaysMs.length) {
            addLog(`Échec de la récupération des détails de la chaîne "${channelTitle}" (${channelId}) : ${err.message || err}. Nouvel essai...`);
            fetchChannelDetails(nextAttempt);
          } else {
            addLog(`Échec définitif de la récupération des détails (avatar, bannière) de la chaîne "${channelTitle}" (${channelId}) après ${retryDelaysMs.length} tentatives : ${err.message || err}`);
          }
        }
      }, retryDelaysMs[attempt]);
    };
    fetchChannelDetails(0);
  }
```

If the file's current content differs from this (line numbers or minor wording may have shifted), find the equivalent block by its `// Ensure channel exists (defaulting single video channels to paused...` comment and use the actual current code as the source of truth for extraction — the logic must be moved verbatim, not rewritten.

- [ ] **Step 2: Add the extracted helper function directly above `ingestUrl`**

Find (search for `export async function ingestUrl(`):

```ts
export async function ingestUrl(
```

Insert immediately before it:

```ts
/**
 * Ensures a channel row exists for the given id, creating it as a passive,
 * paused reference (never actively followed) if it doesn't. Used both by
 * single-video ingestion and playlist ingestion, whenever a video's real
 * uploader channel isn't already known to YouKeep.
 */
function ensureChannelExists(db: any, channelId: string, channelTitle: string): void {
  const channelCheck = db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId);
  if (channelCheck) return;

  db.prepare(`
    INSERT INTO channels (id, title, description, avatar_url, banner_url, sync_status, created_at)
    VALUES (?, ?, ?, ?, ?, 'paused', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(channelId, channelTitle, '', null, null, Date.now());

  // Asynchronously fetch full channel details (avatar, banner, description) in background
  // without inserting other videos. Retried a few times since this is a single fire-and-forget
  // request that can otherwise leave the channel with no avatar forever if it hits a transient
  // yt-dlp/network error.
  const retryDelaysMs = [1000, 5000, 15000];
  const fetchChannelDetails = (attempt: number) => {
    setTimeout(async () => {
      try {
        addLog(`Récupération des détails de la nouvelle chaîne "${channelTitle}" (${channelId}), tentative ${attempt + 1}/${retryDelaysMs.length}...`);
        await ingestUrl(`https://www.youtube.com/channel/${channelId}`, { channelMetadataOnly: true });
      } catch (err: any) {
        const nextAttempt = attempt + 1;
        if (nextAttempt < retryDelaysMs.length) {
          addLog(`Échec de la récupération des détails de la chaîne "${channelTitle}" (${channelId}) : ${err.message || err}. Nouvel essai...`);
          fetchChannelDetails(nextAttempt);
        } else {
          addLog(`Échec définitif de la récupération des détails (avatar, bannière) de la chaîne "${channelTitle}" (${channelId}) après ${retryDelaysMs.length} tentatives : ${err.message || err}`);
        }
      }
    }, retryDelaysMs[attempt]);
  };
  fetchChannelDetails(0);
}

export async function ingestUrl(
```

(`function ensureChannelExists` is a hoisted function declaration, so its position relative to `ingestUrl` in the file doesn't affect whether `ingestUrl` can call it or vice versa — placing it directly above `ingestUrl` is purely for reader locality.)

- [ ] **Step 3: Replace Case B's inline block with a call to the helper**

Find the exact block identified in Step 1 and replace it with:

```ts
  // Case B: It's a single video
  const videoId = data.id;
  const channelId = data.channel_id || 'unknown-channel';
  const channelTitle = data.channel || 'Unknown Channel';

  ensureChannelExists(db, channelId, channelTitle);
```

- [ ] **Step 4: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all existing tests still pass — this is a pure refactor of code with no existing test coverage, so this only confirms nothing ELSE in the codebase broke.

- [ ] **Step 5: Manual smoke test (if `yt-dlp`/network is usable in this environment)**

If unavailable, skip this step and say so explicitly in your report — do not fabricate results.

1. In the running app (or via `curl -X POST http://localhost:PORT/api/admin/downloader/ingest -H "Cookie: ..." -d '{"url":"https://www.youtube.com/watch?v=<a real video id>"}'`), ingest a single video whose channel is NOT already in the `channels` table.
2. Confirm the response is the same shape as before this refactor (`{"success":true,"message":"Video \"...\" has been added to the download queue.","count":1}`).
3. Confirm a new row appears in `channels` with `sync_status = 'paused'`, and that after a few seconds its `avatar_url` gets filled in (the backgrounded retry logic still fires).

- [ ] **Step 6: Commit**

```bash
git add server/utils/downloader.ts
git commit -m "refactor: extract ensureChannelExists helper from single-video ingestion"
```

---

### Task 2: Playlist detection and per-video import in `ingestUrl`

**Files:**
- Modify: `server/utils/downloader.ts`

**Interfaces:**
- Consumes: `ensureChannelExists(db, channelId, channelTitle)` (Task 1).
- Produces: nothing consumed by a later task (last task in this plan).

- [ ] **Step 1: Read the current Case A boundary to confirm the insertion point**

Open `server/utils/downloader.ts` and find (search for `let videosAdded = 0;` followed by `// Case A: It's a playlist or channel`):

```ts
  let videosAdded = 0;

  // Case A: It's a playlist or channel (contains _type: "playlist" or entries array)
  if (data._type === 'playlist' || Array.isArray(data.entries)) {
```

If the current file's text differs slightly, use the `// Case A: It's a playlist or channel` comment as the anchor — the new playlist branch must be inserted between `let videosAdded = 0;` and this `if`, so it runs (and returns) before Case A ever sees a genuine playlist response.

- [ ] **Step 2: Insert the playlist-detection branch**

Replace:

```ts
  let videosAdded = 0;

  // Case A: It's a playlist or channel (contains _type: "playlist" or entries array)
  if (data._type === 'playlist' || Array.isArray(data.entries)) {
```

With:

```ts
  let videosAdded = 0;

  // Playlist detection — must run BEFORE Case A below, which would otherwise
  // wrongly treat a genuine playlist's yt-dlp response (also shaped as
  // {_type: 'playlist', entries: [...]}) as if it were a channel, attributing
  // every video in it to a fake "channel" keyed by the playlist's own id.
  // Each flat-playlist entry already carries its own real channel_id/channel
  // (the video's true uploader), independent of who created the playlist —
  // confirmed against real YouTube playlist responses — so no extra per-video
  // yt-dlp call is needed for correct attribution.
  const playlistPattern = /[?&]list=/;
  if (playlistPattern.test(url) && !channelPattern.test(url.trim())) {
    const playlistTitle = data.title || 'Untitled Playlist';
    const entries = Array.isArray(data.entries) ? data.entries : [];

    const upsertPlaylistVideo = db.prepare(`
      INSERT INTO videos (id, title, description, channel_id, upload_date, duration, view_count, download_status, is_manually_queued, is_short, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        download_status = CASE WHEN download_status != 'completed' THEN 'pending' ELSE download_status END,
        is_manually_queued = CASE WHEN download_status != 'completed' THEN 1 ELSE is_manually_queued END,
        is_short = excluded.is_short
    `);

    let videosQueued = 0;
    for (const entry of entries) {
      if (!entry || !entry.id) continue;

      const entryChannelId = entry.channel_id || entry.uploader_id || 'unknown-channel';
      const entryChannelTitle = entry.channel || entry.uploader || 'Unknown Channel';
      ensureChannelExists(db, entryChannelId, entryChannelTitle);

      const isShortFlag = (entry.webpage_url && entry.webpage_url.includes('/shorts/')) ? 1 : 0;
      // Flat-playlist entries carry `timestamp` (unix epoch seconds), not the
      // `upload_date` (YYYYMMDD string) field full single-video/channel dumps
      // have — convert so this stays comparable with every other upload_date
      // value already stored (e.g. the channel date_after filter elsewhere
      // in this file does a plain string comparison against this format).
      const uploadDate = entry.timestamp
        ? new Date(entry.timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, '')
        : null;

      const res = upsertPlaylistVideo.run(
        entry.id,
        entry.title || `Video ${entry.id}`,
        entry.description || '',
        entryChannelId,
        uploadDate,
        entry.duration || null,
        entry.view_count || null,
        isShortFlag,
        Date.now()
      );
      if (res.changes > 0) videosQueued++;
    }

    // Trigger queue processing unconditionally, same as single-video ingestion —
    // this is a deliberate, manual, one-time import, not a passive subscription.
    startQueueWorker();

    return {
      success: true,
      message: `Playlist "${playlistTitle}" imported. ${videosQueued} video(s) added to the download queue.`,
      count: videosQueued
    };
  }

  // Case A: It's a playlist or channel (contains _type: "playlist" or entries array)
  if (data._type === 'playlist' || Array.isArray(data.entries)) {
```

(The `&& !channelPattern.test(url.trim())` guard is defensive — a genuine playlist URL never matches `channelPattern`, since that regex requires `/channel/`, `@handle`, `/c/`, or `/user/` as the URL's final path segment — but keeping the guard explicit avoids ever double-handling a URL that could theoretically match both patterns.)

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 4: Manual verification**

If `yt-dlp`/network access is unavailable in this environment, skip this step and say so explicitly in your report — do not fabricate results. `yt-dlp` is available at `data/bin/yt-dlp` in this sandbox and was confirmed working against real YouTube playlist/video metadata earlier in this session.

1. Find (or use) a real public YouTube playlist URL containing videos from at least two different channels, ideally one already known to YouKeep and one not (e.g. `https://www.youtube.com/playlist?list=<a real playlist id>`).
2. `curl -X POST http://localhost:PORT/api/admin/downloader/ingest -H "Cookie: youkeep_session=<admin session>" -H "Content-Type: application/json" -d '{"url":"<the playlist URL>"}'`.
3. Confirm the response is `{"success":true,"message":"Playlist \"...\" imported. N video(s) added to the download queue.","count":N}`.
4. Query the DB: confirm each imported video's `channel_id` is its own real uploader's channel id, NOT the playlist's id (`sqlite3 data/youkeep.db "SELECT id, title, channel_id FROM videos WHERE id IN (...)"`).
5. Confirm a previously-unknown channel discovered this way exists in `channels` with `sync_status = 'paused'` (`sqlite3 data/youkeep.db "SELECT id, title, sync_status FROM channels WHERE id = '...'"`) — it should NOT show up as "followed"/actively syncing anywhere in the UI.
6. Confirm the videos actually start downloading (check `download_status` transitions from `pending` to `downloading` to `completed`, or check the admin queue view in Settings → Downloads).
7. Re-run the same `curl` command a second time; confirm the response's count reflects that already-completed videos are not re-queued (count should be lower or zero on the second run, assuming the first run's downloads completed).
8. In the browser, confirm the existing "Add Channel" field in Settings → Downloads accepts the same playlist URL with no UI changes needed — paste it there, submit, confirm the same behavior as the `curl` test.

- [ ] **Step 5: Commit**

```bash
git add server/utils/downloader.ts
git commit -m "feat: correctly attribute videos to their real channel when ingesting a YouTube playlist"
```
