# Wipe All Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an admin a single, heavily-guarded "wipe everything" action in Settings → System that permanently deletes every video, music track, and podcast episode — DB rows and files on disk — across every channel, artist, and show.

**Architecture:** Video already has full delete support (per-video and per-channel, with file cleanup) that this plan does not touch. Music and podcasts have no delete support at all today, so this plan first builds artist-level and show-level delete functions that mirror the existing channel-delete route exactly (cancel active downloads for the collection's items, `fs.rmSync` its directory, `DELETE` the row and let `ON DELETE CASCADE` handle everything downstream — confirmed complete for both `music_artists→music_albums→music_tracks` and `podcast_shows→podcast_episodes`). A new orchestrator module then loops over every channel/artist/show using these three delete paths, tracking progress and a final success/failure report in memory. Three new admin routes (preview/start/status) expose this to a new "Danger Zone" panel in Settings, gated by a typed exact-match confirmation word instead of the app's usual `window.confirm()`.

**Tech Stack:** Nuxt 4 (Vue 3 `<script setup>`), Nitro (H3), better-sqlite3, Vitest 4 (`npm test` → `vitest run`).

## Global Constraints

- No deleting user accounts.
- No deleting personal playlists, channel subscriptions, or watch history records — they are emptied as a side effect of cascading video/track/episode deletion (already wired via existing `ON DELETE CASCADE` FKs), but the containers themselves survive.
- No general-purpose single-artist or single-show delete UI/button added to the Music/Podcasts settings tabs — only the underlying delete function + a REST endpoint for each, no new UI affordance beyond what already exists.
- No change to the existing per-video or per-channel delete flows (`server/api/admin/videos/[id].delete.ts`, `server/api/admin/channels/[id].delete.ts`) — read-only references for this plan.
- No orphan-file reconciliation/repair tool.
- No undo/trash/soft-delete — deletion is immediate and permanent.
- No scheduling/dry-run-only mode beyond the one-shot preview step.
- No change to the three pipelines' existing per-item concurrency or combined-cap settings.
- File-deletion/`fs.rmSync` logic gets no automated tests, matching this codebase's established convention for this exact class of I/O-heavy destructive code (the existing channel/video delete routes have none either) — but the orchestrator's pure report-building and progress-state logic (data in, data out, no DB/fs) does get real unit tests, following this codebase's established pattern (`tests/unit/chapters.test.ts`) of testing the genuinely pure slice within an otherwise-untested I/O module.
- The wipe-in-progress flag must block all three download queue workers from starting new downloads for the duration, and must reject a second concurrent wipe-all request with a 409.
- Confirmation must be a typed exact-match word, not a plain `confirm()` dialog.
- Error handling is best-effort/continue-on-failure across channels/artists/shows, with a final report distinguishing successes from failures (not silently swallowed, unlike today's per-file unlink failures).

---

## File Structure

| File | Change |
|---|---|
| `server/utils/musicDownloader.ts` | Modify — add `deleteMusicArtist(artistId)` |
| `server/api/admin/music/artists/[id].delete.ts` | Create — thin route wrapping `deleteMusicArtist` |
| `server/utils/podcastDownloader.ts` | Modify — add `deletePodcastShow(showId)` |
| `server/api/admin/podcasts/shows/[id].delete.ts` | Create — thin route wrapping `deletePodcastShow` |
| `server/utils/libraryWipe.ts` | Create — the orchestrator: preview query, in-memory progress/flag state, `runLibraryWipe()`, and the pure `buildWipeReport`/progress-state functions |
| `tests/unit/libraryWipe.test.ts` | Create — unit tests for the pure pieces of `libraryWipe.ts` |
| `server/utils/downloader.ts` | Modify — check the wipe flag in `startQueueWorker`'s loop |
| `server/utils/musicDownloader.ts` | Modify (same file as above, separate edit) — check the wipe flag in `startMusicQueueWorker`'s loop |
| `server/utils/podcastDownloader.ts` | Modify (same file as above, separate edit) — check the wipe flag in `startPodcastQueueWorker`'s loop |
| `server/api/admin/system/wipe-preview.get.ts` | Create |
| `server/api/admin/system/wipe-all.post.ts` | Create |
| `server/api/admin/system/wipe-status.get.ts` | Create |
| `app/components/settings/SettingsSystemTab.vue` | Modify — new "Danger Zone" panel |

---

### Task 1: Music artist delete (function + endpoint)

**Files:**
- Modify: `server/utils/musicDownloader.ts` (add a new exported function; insert after `cleanupPartialMusicFiles`, i.e. after line 115 as of this plan's writing — locate by the function name if the file has shifted)
- Create: `server/api/admin/music/artists/[id].delete.ts`
- Test: none (established convention — file-deletion logic gets no automated tests)

**Interfaces:**
- Consumes: `getDb()`, `getMusicDownloadsDir()`, `sanitizeFolderName()` (all already exported from `server/utils/downloader.ts`/`musicDownloader.ts` and auto-imported by Nitro), `cancelMusicDownload(trackId)` (`musicDownloader.ts:745`).
- Produces: `deleteMusicArtist(artistId: string): { success: true } | { success: false; error: string }` — used by Task 3's orchestrator. `DELETE /api/admin/music/artists/[id]` — a real, independently-callable admin endpoint (per the spec, built as proper REST even though no UI button is added for it in this project).

- [ ] **Step 1: Add `deleteMusicArtist` to `server/utils/musicDownloader.ts`**

Add this function (place it right after `cleanupPartialMusicFiles`, before `startMusicQueueWorker`):

```ts
export function deleteMusicArtist(artistId: string): { success: true } | { success: false; error: string } {
  const db = getDb();

  const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(artistId) as { name: string } | undefined;
  if (!artist) {
    return { success: false, error: 'Artist not found.' };
  }

  // 1. Find all tracks for this artist and kill any active downloads —
  // mirrors channels.delete.ts's identical loop for videos.
  const tracks = db.prepare('SELECT id FROM music_tracks WHERE artist_id = ?').all(artistId) as { id: string }[];
  for (const t of tracks) {
    cancelMusicDownload(t.id);
  }

  // 2. Delete the artist row (cascades to music_albums, music_tracks,
  // music_track_artists, music_play_history via ON DELETE CASCADE).
  const res = db.prepare('DELETE FROM music_artists WHERE id = ?').run(artistId);
  if (res.changes === 0) {
    return { success: false, error: 'Artist not found.' };
  }

  // 3. Delete the artist's media folder recursively. Music has no
  // custom_save_path equivalent (unlike channels), so this is always
  // relative to getMusicDownloadsDir(). A removal failure here is logged but
  // does NOT make this function report failure — the DB row (the real
  // "this content is gone" signal) is already deleted at this point,
  // matching channels/[id].delete.ts's established convention.
  const artistDir = path.join(getMusicDownloadsDir(), sanitizeFolderName(artist.name || artistId));
  if (fs.existsSync(artistDir)) {
    try {
      fs.rmSync(artistDir, { recursive: true, force: true });
    } catch (err: any) {
      console.error(`Failed to delete artist directory ${artistDir}:`, err);
    }
  }

  return { success: true };
}
```

- [ ] **Step 2: Create the admin route**

Create `server/api/admin/music/artists/[id].delete.ts`:

```ts
import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const result = deleteMusicArtist(artistId);
  if (!result.success) {
    throw createError({ statusCode: 404, statusMessage: result.error });
  }

  return { success: true };
});
```

- [ ] **Step 3: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/light/Git/youkeep
git add server/utils/musicDownloader.ts server/api/admin/music/artists/[id].delete.ts
git commit -m "feat: add music artist delete (DB + files)

Mirrors the existing channel-delete route exactly: cancel active track
downloads, delete the artist row (cascades to albums/tracks/play-history),
then remove the artist's media directory. Music has no custom_save_path
equivalent, so the directory is always relative to getMusicDownloadsDir().
No UI button added for this yet — it exists as a real endpoint because the
upcoming wipe-all-libraries feature needs this logic as a building block.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Podcast show delete (function + endpoint)

**Files:**
- Modify: `server/utils/podcastDownloader.ts` (add a new exported function; insert after `cleanupPartialPodcastFiles`)
- Create: `server/api/admin/podcasts/shows/[id].delete.ts`
- Test: none (established convention)

**Interfaces:**
- Consumes: `getDb()`, `getPodcastDownloadsDir()`, `sanitizeFolderName()`, `cancelPodcastDownload(episodeId)` (`podcastDownloader.ts:700`).
- Produces: `deletePodcastShow(showId: string): { success: true } | { success: false; error: string }` — used by Task 3. `DELETE /api/admin/podcasts/shows/[id]`.

- [ ] **Step 1: Add `deletePodcastShow` to `server/utils/podcastDownloader.ts`**

Add this function (place it right after `cleanupPartialPodcastFiles`, before `startPodcastQueueWorker`):

```ts
export function deletePodcastShow(showId: string): { success: true } | { success: false; error: string } {
  const db = getDb();

  const show = db.prepare('SELECT title FROM podcast_shows WHERE id = ?').get(showId) as { title: string } | undefined;
  if (!show) {
    return { success: false, error: 'Show not found.' };
  }

  // 1. Find all episodes for this show and kill any active downloads.
  const episodes = db.prepare('SELECT id FROM podcast_episodes WHERE show_id = ?').all(showId) as { id: string }[];
  for (const e of episodes) {
    cancelPodcastDownload(e.id);
  }

  // 2. Delete the show row (cascades to podcast_episodes via ON DELETE CASCADE).
  const res = db.prepare('DELETE FROM podcast_shows WHERE id = ?').run(showId);
  if (res.changes === 0) {
    return { success: false, error: 'Show not found.' };
  }

  // 3. Delete the show's media folder recursively. Podcasts have no
  // custom_save_path equivalent, so this is always relative to
  // getPodcastDownloadsDir(). A removal failure here is logged but does NOT
  // make this function report failure — the DB row (the real "this content
  // is gone" signal) is already deleted at this point, matching the
  // established convention in channels/[id].delete.ts (confirmed during
  // Task 1's review: reporting failure here would misleadingly tell the
  // wipe-all report that already-deleted content needs retrying).
  const showDir = path.join(getPodcastDownloadsDir(), sanitizeFolderName(show.title || showId));
  if (fs.existsSync(showDir)) {
    try {
      fs.rmSync(showDir, { recursive: true, force: true });
    } catch (err: any) {
      console.error(`Failed to delete show directory ${showDir}:`, err);
    }
  }

  return { success: true };
}
```

- [ ] **Step 2: Create the admin route**

Create `server/api/admin/podcasts/shows/[id].delete.ts`:

```ts
import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const showId = event.context.params?.id;

  if (!showId) {
    throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
  }

  const result = deletePodcastShow(showId);
  if (!result.success) {
    throw createError({ statusCode: 404, statusMessage: result.error });
  }

  return { success: true };
});
```

- [ ] **Step 3: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/light/Git/youkeep
git add server/utils/podcastDownloader.ts server/api/admin/podcasts/shows/[id].delete.ts
git commit -m "feat: add podcast show delete (DB + files)

Mirrors the existing channel-delete route exactly: cancel active episode
downloads, delete the show row (cascades to episodes), then remove the
show's media directory. No UI button added for this yet — it exists as a
real endpoint because the upcoming wipe-all-libraries feature needs this
logic as a building block.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: The wipe orchestrator module (with unit-tested pure logic)

**Files:**
- Create: `server/utils/libraryWipe.ts`
- Create: `tests/unit/libraryWipe.test.ts`
- Test: `tests/unit/libraryWipe.test.ts` (real, run in this task)

**Interfaces:**
- Consumes: `deleteMusicArtist` (Task 1), `deletePodcastShow` (Task 2), `getDb()`, `cancelDownload(videoId)` (`downloader.ts:991`), `getDownloadsDir()`, `sanitizeFolderName()`.
- Produces (consumed by Task 4's routes):
  - `type WipeItemType = 'channel' | 'artist' | 'show'`
  - `type WipeOutcome = { type: WipeItemType; id: string; name: string; error?: string }`
  - `type WipeReport = { succeeded: { type: WipeItemType; id: string; name: string }[]; failed: WipeOutcome[] }`
  - `buildWipeReport(outcomes: WipeOutcome[]): WipeReport` — pure function, unit tested.
  - `type WipeProgress = { type: WipeItemType; name: string; index: number; total: number } | null`
  - `getWipePreview(): { channelCount: number; videoCount: number; artistCount: number; trackCount: number; showCount: number; episodeCount: number; estimatedBytes: number }`
  - `isWipeInProgress(): boolean`
  - `getWipeProgress(): WipeProgress`
  - `getWipeReport(): WipeReport | null` (the last completed run's report; `null` before any run or while one is in progress)
  - `startLibraryWipe(): { started: true } | { started: false; error: string }` — returns immediately, `409`-worthy `{started:false}` if already running; runs `runLibraryWipeInternal()` in the background (fire-and-forget, same pattern as the three queue workers' per-item downloads).

- [ ] **Step 1: Write the failing tests for the pure logic**

Create `tests/unit/libraryWipe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWipeReport } from '../../server/utils/libraryWipe';

describe('buildWipeReport', () => {
  it('returns empty succeeded/failed for an empty outcome list', () => {
    expect(buildWipeReport([])).toEqual({ succeeded: [], failed: [] });
  });

  it('puts an outcome with no error into succeeded, stripped of the error field', () => {
    const result = buildWipeReport([{ type: 'channel', id: 'c1', name: 'Some Channel' }]);
    expect(result).toEqual({
      succeeded: [{ type: 'channel', id: 'c1', name: 'Some Channel' }],
      failed: []
    });
  });

  it('puts an outcome with an error into failed, keeping the error message', () => {
    const result = buildWipeReport([{ type: 'artist', id: 'a1', name: 'Some Artist', error: 'disk full' }]);
    expect(result).toEqual({
      succeeded: [],
      failed: [{ type: 'artist', id: 'a1', name: 'Some Artist', error: 'disk full' }]
    });
  });

  it('splits a mixed list of successes and failures in original order within each bucket', () => {
    const outcomes = [
      { type: 'channel' as const, id: 'c1', name: 'Channel One' },
      { type: 'artist' as const, id: 'a1', name: 'Artist One', error: 'permission denied' },
      { type: 'show' as const, id: 's1', name: 'Show One' },
      { type: 'channel' as const, id: 'c2', name: 'Channel Two', error: 'not found' },
    ];
    const result = buildWipeReport(outcomes);
    expect(result.succeeded).toEqual([
      { type: 'channel', id: 'c1', name: 'Channel One' },
      { type: 'show', id: 's1', name: 'Show One' },
    ]);
    expect(result.failed).toEqual([
      { type: 'artist', id: 'a1', name: 'Artist One', error: 'permission denied' },
      { type: 'channel', id: 'c2', name: 'Channel Two', error: 'not found' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/light/Git/youkeep && npx vitest run tests/unit/libraryWipe.test.ts`
Expected: FAIL — `server/utils/libraryWipe.ts` does not exist yet, so the import fails.

- [ ] **Step 3: Create `server/utils/libraryWipe.ts` with the full module**

```ts
import path from 'path';
import fs from 'fs';

export type WipeItemType = 'channel' | 'artist' | 'show';

export interface WipeOutcome {
  type: WipeItemType;
  id: string;
  name: string;
  error?: string;
}

export interface WipeReport {
  succeeded: { type: WipeItemType; id: string; name: string }[];
  failed: WipeOutcome[];
}

/**
 * Pure: splits a flat list of per-item outcomes into succeeded/failed,
 * preserving each bucket's original relative order. No DB, no fs — the one
 * genuinely unit-testable piece of this module.
 */
export function buildWipeReport(outcomes: WipeOutcome[]): WipeReport {
  const succeeded: WipeReport['succeeded'] = [];
  const failed: WipeOutcome[] = [];
  for (const o of outcomes) {
    if (o.error) {
      failed.push(o);
    } else {
      succeeded.push({ type: o.type, id: o.id, name: o.name });
    }
  }
  return { succeeded, failed };
}

export interface WipePreview {
  channelCount: number;
  videoCount: number;
  artistCount: number;
  trackCount: number;
  showCount: number;
  episodeCount: number;
  estimatedBytes: number;
}

export function getWipePreview(): WipePreview {
  const db = getDb();

  const channelCount = (db.prepare('SELECT COUNT(*) as count FROM channels').get() as any).count;
  const videoAgg = db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as bytes FROM videos').get() as any;
  const artistCount = (db.prepare('SELECT COUNT(*) as count FROM music_artists').get() as any).count;
  const trackAgg = db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as bytes FROM music_tracks').get() as any;
  const showCount = (db.prepare('SELECT COUNT(*) as count FROM podcast_shows').get() as any).count;
  // podcast_episodes has no size_bytes column — its contribution to the
  // estimate is always 0, not computed by walking the filesystem (would be
  // slow and is explicitly out of scope per the design's preview being a
  // best-effort estimate, not an exact figure).
  const episodeCount = (db.prepare('SELECT COUNT(*) as count FROM podcast_episodes').get() as any).count;

  const estimatedBytes = (videoAgg.bytes || 0) + (trackAgg.bytes || 0);

  return {
    channelCount,
    videoCount: videoAgg.count,
    artistCount,
    trackCount: trackAgg.count,
    showCount,
    episodeCount,
    estimatedBytes
  };
}

// In-memory wipe state, using the same globalThis-Symbol pattern as
// activeMusicProcesses/isProcessing elsewhere in this codebase, so it
// survives Nitro's dev-mode module reloads without becoming stale across
// two different module instances.
const G_WIPE_IN_PROGRESS = Symbol.for('YouKeep.libraryWipeInProgress');
const G_WIPE_PROGRESS = Symbol.for('YouKeep.libraryWipeProgress');
const G_WIPE_REPORT = Symbol.for('YouKeep.libraryWipeReport');
const _g = globalThis as any;
if (_g[G_WIPE_IN_PROGRESS] === undefined) _g[G_WIPE_IN_PROGRESS] = false;
if (_g[G_WIPE_PROGRESS] === undefined) _g[G_WIPE_PROGRESS] = null;
if (_g[G_WIPE_REPORT] === undefined) _g[G_WIPE_REPORT] = null;

export interface WipeProgress {
  type: WipeItemType;
  name: string;
  index: number;
  total: number;
}

export function isWipeInProgress(): boolean {
  return _g[G_WIPE_IN_PROGRESS];
}

export function getWipeProgress(): WipeProgress | null {
  return _g[G_WIPE_PROGRESS];
}

export function getWipeReport(): WipeReport | null {
  return _g[G_WIPE_REPORT];
}

export function startLibraryWipe(): { started: true } | { started: false; error: string } {
  if (isWipeInProgress()) {
    return { started: false, error: 'A library wipe is already in progress.' };
  }
  _g[G_WIPE_IN_PROGRESS] = true;
  _g[G_WIPE_PROGRESS] = null;
  _g[G_WIPE_REPORT] = null;

  // Fire-and-forget, same pattern as the per-item downloads in the three
  // queue workers — the caller (the API route) returns immediately and the
  // frontend polls getWipeProgress()/getWipeReport() for status.
  runLibraryWipeInternal().catch((err) => {
    console.error('Library wipe crashed unexpectedly:', err);
    _g[G_WIPE_IN_PROGRESS] = false;
  });

  return { started: true };
}

async function runLibraryWipeInternal(): Promise<void> {
  const db = getDb();
  const outcomes: WipeOutcome[] = [];

  const channels = db.prepare('SELECT id, title FROM channels').all() as { id: string; title: string }[];
  const artists = db.prepare('SELECT id, name FROM music_artists').all() as { id: string; name: string }[];
  const shows = db.prepare('SELECT id, title FROM podcast_shows').all() as { id: string; title: string }[];

  const total = channels.length + artists.length + shows.length;
  let index = 0;

  for (const c of channels) {
    index += 1;
    _g[G_WIPE_PROGRESS] = { type: 'channel', name: c.title, index, total };
    outcomes.push(deleteChannelForWipe(c.id, c.title));
  }

  for (const a of artists) {
    index += 1;
    _g[G_WIPE_PROGRESS] = { type: 'artist', name: a.name, index, total };
    const result = deleteMusicArtist(a.id);
    outcomes.push({ type: 'artist', id: a.id, name: a.name, error: result.success ? undefined : result.error });
  }

  for (const s of shows) {
    index += 1;
    _g[G_WIPE_PROGRESS] = { type: 'show', name: s.title, index, total };
    const result = deletePodcastShow(s.id);
    outcomes.push({ type: 'show', id: s.id, name: s.title, error: result.success ? undefined : result.error });
  }

  _g[G_WIPE_REPORT] = buildWipeReport(outcomes);
  _g[G_WIPE_PROGRESS] = null;
  _g[G_WIPE_IN_PROGRESS] = false;
}

// Mirrors channels/[id].delete.ts's exact logic (custom_save_path aware),
// but as a plain function rather than an HTTP route, since the wipe loop
// needs to call it many times without going through H3.
function deleteChannelForWipe(channelId: string, title: string): WipeOutcome {
  const db = getDb();
  try {
    const videos = db.prepare('SELECT id FROM videos WHERE channel_id = ?').all(channelId) as { id: string }[];
    const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as {
      title: string;
      custom_save_path: string | null;
    } | undefined;

    for (const v of videos) {
      cancelDownload(v.id);
    }

    const res = db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
    if (res.changes === 0) {
      return { type: 'channel', id: channelId, name: title, error: 'Channel not found.' };
    }

    const basePath = channel?.custom_save_path && channel.custom_save_path.trim().length > 0
      ? channel.custom_save_path
      : getDownloadsDir();
    const channelDir = path.resolve(basePath, sanitizeFolderName(channel?.title || channelId));
    if (fs.existsSync(channelDir)) {
      // Own try/catch, deliberately not re-thrown into the outer catch below:
      // the DB row is already deleted at this point (the real "this content
      // is gone" signal), so a directory-removal failure is logged but must
      // not turn this into a reported failure — matches the fix Task 1's
      // review required for deleteMusicArtist, and the convention
      // deletePodcastShow already followed correctly from the start.
      try {
        fs.rmSync(channelDir, { recursive: true, force: true });
      } catch (fsErr: any) {
        console.error(`Failed to delete channel directory ${channelDir}:`, fsErr);
      }
    }

    return { type: 'channel', id: channelId, name: title };
  } catch (err: any) {
    // This outer catch is for genuine failures BEFORE the DB row is
    // deleted (e.g. a query error) — a real failure, correctly reported.
    return { type: 'channel', id: channelId, name: title, error: err.message || String(err) };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/light/Git/youkeep && npx vitest run tests/unit/libraryWipe.test.ts`
Expected: PASS (4/4 tests).

- [ ] **Step 5: Confirm the whole existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/light/Git/youkeep
git add server/utils/libraryWipe.ts tests/unit/libraryWipe.test.ts
git commit -m "feat: add the library-wipe orchestrator module

runLibraryWipeInternal() loops over every channel, then every music artist,
then every podcast show, deleting each (reusing deleteMusicArtist and
deletePodcastShow from the previous two commits, plus an inlined
deleteChannelForWipe mirroring channels/[id].delete.ts's exact logic since
the loop needs a plain function, not an HTTP route). Best-effort: one
failure doesn't stop the rest. Progress and the final report are tracked
in-memory via the same globalThis-Symbol pattern already used for
activeMusicProcesses/isProcessing elsewhere in this codebase.

buildWipeReport() — the one genuinely pure piece — gets real unit tests,
matching the established convention (tests/unit/chapters.test.ts) of
testing the testable slice within an otherwise I/O-heavy, untested module.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Admin API routes + wiring the in-progress flag into the three queue workers

**Files:**
- Create: `server/api/admin/system/wipe-preview.get.ts`
- Create: `server/api/admin/system/wipe-all.post.ts`
- Create: `server/api/admin/system/wipe-status.get.ts`
- Modify: `server/utils/downloader.ts` (one new check inside `startQueueWorker`'s loop)
- Modify: `server/utils/musicDownloader.ts` (one new check inside `startMusicQueueWorker`'s loop)
- Modify: `server/utils/podcastDownloader.ts` (one new check inside `startPodcastQueueWorker`'s loop)
- Test: none (established convention — these are thin routes and worker-loop wiring, not pure logic)

**Interfaces:**
- Consumes: `getWipePreview`, `startLibraryWipe`, `isWipeInProgress`, `getWipeProgress`, `getWipeReport` (Task 3).
- Produces: `GET /api/admin/system/wipe-preview` → `WipePreview` JSON. `POST /api/admin/system/wipe-all` → `{ started: true }` (200) or a 409 with the error message. `GET /api/admin/system/wipe-status` → `{ inProgress: boolean; current: WipeProgress | null; report: WipeReport | null }` — consumed by Task 5's frontend polling.

- [ ] **Step 1: Create the preview route**

Create `server/api/admin/system/wipe-preview.get.ts`:

```ts
import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return getWipePreview();
});
```

- [ ] **Step 2: Create the start-wipe route**

Create `server/api/admin/system/wipe-all.post.ts`:

```ts
import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const result = startLibraryWipe();
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }

  return { started: true };
});
```

- [ ] **Step 3: Create the status route**

Create `server/api/admin/system/wipe-status.get.ts`:

```ts
import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return {
    inProgress: isWipeInProgress(),
    current: getWipeProgress(),
    report: getWipeReport()
  };
});
```

- [ ] **Step 4: Block the video queue worker during a wipe**

In `server/utils/downloader.ts`, find the `downloader_paused` check inside `startQueueWorker`'s `while` loop:

```ts
        // Check if global download is paused
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          // Don't exit — just wait and poll again when unpaused
          await sleepOrWakeable(5000);
          continue;
        }
```

Replace it with:

```ts
        // Check if global download is paused
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          // Don't exit — just wait and poll again when unpaused
          await sleepOrWakeable(5000);
          continue;
        }

        // A library wipe is deleting channels/videos right now — don't start
        // any new download while that's happening.
        if (isWipeInProgress()) {
          await sleepOrWakeable(5000);
          continue;
        }
```

- [ ] **Step 5: Block the music queue worker during a wipe**

In `server/utils/musicDownloader.ts`, find the equivalent check inside `startMusicQueueWorker`'s loop:

```ts
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          await sleepOrWakeableMusic(5000);
          continue;
        }
```

Replace it with:

```ts
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          await sleepOrWakeableMusic(5000);
          continue;
        }

        // A library wipe is deleting artists/tracks right now — don't start
        // any new download while that's happening.
        if (isWipeInProgress()) {
          await sleepOrWakeableMusic(5000);
          continue;
        }
```

- [ ] **Step 6: Block the podcast queue worker during a wipe**

In `server/utils/podcastDownloader.ts`, find the equivalent check inside `startPodcastQueueWorker`'s loop:

```ts
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          await sleepOrWakeablePodcast(5000);
          continue;
        }
```

Replace it with:

```ts
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          await sleepOrWakeablePodcast(5000);
          continue;
        }

        // A library wipe is deleting shows/episodes right now — don't start
        // any new download while that's happening.
        if (isWipeInProgress()) {
          await sleepOrWakeablePodcast(5000);
          continue;
        }
```

- [ ] **Step 7: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/light/Git/youkeep
git add server/api/admin/system/wipe-preview.get.ts server/api/admin/system/wipe-all.post.ts server/api/admin/system/wipe-status.get.ts server/utils/downloader.ts server/utils/musicDownloader.ts server/utils/podcastDownloader.ts
git commit -m "feat: expose library-wipe preview/start/status admin routes

Also wires isWipeInProgress() into all three queue workers' loop
conditions, in the same spot each already checks its own
*_downloader_paused setting, so no new download can start while a wipe is
deleting content out from under it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Danger Zone UI in Settings → System

**Files:**
- Modify: `app/components/settings/SettingsSystemTab.vue`
- Test: none (this bug/feature class — UI wiring around a destructive admin action — has no automated test coverage anywhere in this codebase; see Global Constraints)

**Interfaces:**
- Consumes: `GET /api/admin/system/wipe-preview`, `POST /api/admin/system/wipe-all`, `GET /api/admin/system/wipe-status` (Task 4).
- Produces: nothing further downstream — this is the final user-facing piece.

- [ ] **Step 1: Add the Danger Zone panel to the template**

In `app/components/settings/SettingsSystemTab.vue`, find the closing `</div>` of `.system-diagnostic-col` (the left column described in the spec's investigation) and add a new panel as the last child of `.system-dashboard-layout`, after both existing columns' content — i.e., insert this markup just before the final `</div></div>` that closes `.system-dashboard-layout` and the outer `.tab-pane`:

```vue
    <div class="config-section glass-panel danger-zone-panel">
      <div class="section-title-row">
        <div class="icon-orb bg-pink">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        </div>
        <div>
          <h3>Danger Zone</h3>
          <p class="section-desc">Permanently delete every video, music track, and podcast episode — files and database records — across the whole archive. This cannot be undone.</p>
        </div>
      </div>

      <div v-if="!wipePreview" class="mt-3">
        <button @click="loadWipePreview" class="btn btn-secondary-dark" :disabled="loadingWipePreview">
          {{ loadingWipePreview ? 'Loading...' : 'Show what will be deleted' }}
        </button>
      </div>

      <div v-else-if="!wipeInProgress && !wipeReport" class="mt-3 danger-zone-preview">
        <p class="danger-zone-summary">
          This will permanently delete
          <strong>{{ wipePreview.channelCount }}</strong> channel(s) ({{ wipePreview.videoCount }} video(s)),
          <strong>{{ wipePreview.artistCount }}</strong> artist(s) ({{ wipePreview.trackCount }} track(s)), and
          <strong>{{ wipePreview.showCount }}</strong> show(s) ({{ wipePreview.episodeCount }} episode(s)) —
          an estimated <strong>{{ formatBytes(wipePreview.estimatedBytes) }}</strong> of files.
        </p>
        <p class="danger-zone-hint">Type <code>SUPPRIMER</code> below to enable the button.</p>
        <input
          v-model="wipeConfirmText"
          type="text"
          class="form-input mt-2"
          placeholder="SUPPRIMER"
          :disabled="startingWipe"
        />
        <button
          @click="handleStartWipe"
          class="btn btn-danger mt-3"
          :disabled="wipeConfirmText !== 'SUPPRIMER' || startingWipe"
        >
          {{ startingWipe ? 'Starting...' : 'Wipe everything' }}
        </button>
      </div>

      <div v-else-if="wipeInProgress" class="mt-3 danger-zone-progress">
        <p v-if="wipeCurrent">
          Deleting: {{ wipeCurrent.type }} "{{ wipeCurrent.name }}" ({{ wipeCurrent.index }}/{{ wipeCurrent.total }})
        </p>
        <p v-else>Starting...</p>
      </div>

      <div v-else-if="wipeReport" class="mt-3 danger-zone-report">
        <p class="settings-success-msg">{{ wipeReport.succeeded.length }} item(s) deleted successfully.</p>
        <div v-if="wipeReport.failed.length > 0" class="settings-error-msg mt-2">
          <p>{{ wipeReport.failed.length }} item(s) failed:</p>
          <ul>
            <li v-for="f in wipeReport.failed" :key="f.id">{{ f.type }} "{{ f.name }}": {{ f.error }}</li>
          </ul>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Add the script logic**

In `app/components/settings/SettingsSystemTab.vue`'s `<script setup>` block, add (near the other `ref`/function declarations in the file):

```ts
const wipePreview = ref<{
  channelCount: number; videoCount: number;
  artistCount: number; trackCount: number;
  showCount: number; episodeCount: number;
  estimatedBytes: number;
} | null>(null);
const loadingWipePreview = ref(false);
const wipeConfirmText = ref('');
const startingWipe = ref(false);
const wipeInProgress = ref(false);
const wipeCurrent = ref<{ type: string; name: string; index: number; total: number } | null>(null);
const wipeReport = ref<{ succeeded: any[]; failed: any[] } | null>(null);
let wipePollTimeout: any = null;

async function loadWipePreview() {
  loadingWipePreview.value = true;
  try {
    wipePreview.value = await $fetch('/api/admin/system/wipe-preview');
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Failed to load the wipe preview.');
  } finally {
    loadingWipePreview.value = false;
  }
}

async function handleStartWipe() {
  if (wipeConfirmText.value !== 'SUPPRIMER') return;
  startingWipe.value = true;
  try {
    await $fetch('/api/admin/system/wipe-all', { method: 'POST' });
    wipeInProgress.value = true;
    wipeConfirmText.value = '';
    pollWipeStatus();
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Failed to start the wipe.');
  } finally {
    startingWipe.value = false;
  }
}

async function pollWipeStatus() {
  try {
    const status = await $fetch<{ inProgress: boolean; current: any; report: any }>('/api/admin/system/wipe-status');
    wipeInProgress.value = status.inProgress;
    wipeCurrent.value = status.current;
    if (!status.inProgress && status.report) {
      wipeReport.value = status.report;
      wipePreview.value = null;
      return;
    }
  } catch (e) {
    // Keep polling even on a transient fetch error — matches this app's
    // existing queue-polling resilience (runPolling in settings.vue never
    // stops on a single failed fetch either).
  }
  wipePollTimeout = setTimeout(pollWipeStatus, 1000);
}

onUnmounted(() => {
  if (wipePollTimeout) clearTimeout(wipePollTimeout);
});

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
```

If `onUnmounted` is not already imported from `'vue'` at the top of this file's `<script setup>` block, add it to the existing `import { ... } from 'vue';` line.

- [ ] **Step 3: Add the Danger Zone styling**

In `app/pages/settings.vue`'s `<style>` block (the single home for all Settings CSS — confirmed in the sub-project 4 architecture notes; none of the tab components have their own `<style>` block), add, near the other `.config-section`-related rules:

```css
.settings-container .danger-zone-panel {
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.settings-container .danger-zone-summary {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.settings-container .danger-zone-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 12px;
}

.settings-container .danger-zone-hint code {
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-primary);
}

.settings-container .danger-zone-report ul {
  margin-top: 8px;
  padding-left: 20px;
  font-size: 13px;
}
```

- [ ] **Step 4: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/components/settings/SettingsSystemTab.vue app/pages/settings.vue
git commit -m "feat: add Danger Zone panel with library-wipe UI

Preview step (item counts + estimated size) before the confirmation input
unlocks; typed exact-match confirmation (SUPPRIMER) instead of this app's
usual window.confirm(); 1s status polling during the wipe (matching the
existing download-queue polling interval convention); a final report
distinguishing successes from failures.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Manual end-to-end verification

**Files:**
- Modify: none
- Test: none automated — this task is the verification

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a verified, working feature. Final task.

- [ ] **Step 1: Start the dev server and log in**

`.claude/launch.json`'s `youkeep-dev` configuration already exists. Start it via `preview_start` with `name: "youkeep-dev"`.

A local, gitignored `.env` with `ALLOW_DEV_LOGIN=1` should already exist at `/Users/light/Git/youkeep/.env`. Log in via:

```js
const csrf = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))?.split('=')[1];
await fetch('/api/dev/login', { method: 'POST', headers: {'content-type':'application/json', 'x-csrf-token': csrf || ''}, body: '{}' }).then(r => r.status)
```

Expected: `200`.

- [ ] **Step 2: Confirm real content exists to wipe**

```js
const videos = await fetch('/api/videos?limit=1').then(r=>r.json());
const artists = await fetch('/api/music/artists').then(r=>r.json());
const shows = await fetch('/api/podcasts/shows').then(r=>r.json());
({ hasVideo: videos.videos?.length > 0, hasArtist: artists.artists?.length > 0, hasShow: shows.shows?.length > 0 })
```

Expected: at least one of these is `true` in the dev database used for this verification (if the database is empty, seed at least one real download of each type first — a wipe test against an already-empty database proves nothing).

- [ ] **Step 3: Verify Task 1 and Task 2's new endpoints work in isolation**

Pick one music artist id and one podcast show id from Step 2's response (if any exist). For each:

```js
const r = await fetch('/api/admin/music/artists/<artistId>', { method: 'DELETE', headers: {'x-csrf-token': csrf} });
r.status
```

Expected: `200`, and a follow-up `GET /api/music/artists` no longer lists that artist. Repeat for the podcast show via `DELETE /api/admin/podcasts/shows/<showId>`. (If you deleted your only test artist/show here, re-seed before Step 4 so the full wipe has real multi-type content to work through.)

- [ ] **Step 4: Navigate to Settings → System and confirm the Danger Zone panel renders**

Navigate to `/settings` and click the System tab (or use `?tab=system`, which is already in `allowedTabs`). Confirm the "Danger Zone" panel appears with the "Show what will be deleted" button.

- [ ] **Step 5: Verify the preview step shows real numbers**

Click "Show what will be deleted". Confirm the rendered summary's counts match what Step 2 found in the database (re-query the same endpoints to compare), and that the estimated size is a plausible non-negative number.

- [ ] **Step 6: Verify the confirmation gate actually gates**

Confirm the "Wipe everything" button is disabled with an empty confirmation field, stays disabled when a wrong value is typed (e.g. `supprimer` lowercase, or `SUPPRIME`), and becomes enabled only when the field exactly matches `SUPPRIMER`.

- [ ] **Step 7: Run the actual wipe and verify progress + completion**

Type `SUPPRIMER` and click "Wipe everything". Confirm the panel switches to showing progress (`Deleting: <type> "<name>" (<index>/<total>)`), updating over time via polling, and that it eventually shows a completion report with a succeeded count matching the preview's total item count (channels + artists + shows) assuming no failures.

- [ ] **Step 8: Verify the database and disk are actually empty afterward**

```js
const videos = await fetch('/api/videos?limit=1').then(r=>r.json());
const artists = await fetch('/api/music/artists').then(r=>r.json());
const shows = await fetch('/api/podcasts/shows').then(r=>r.json());
({ videosLeft: videos.videos?.length, artistsLeft: artists.artists?.length, showsLeft: shows.shows?.length })
```

Expected: all zero. Separately, confirm (via whatever filesystem access this verification session has — a `Bash` tool `find`/`ls` on the resolved downloads directories, e.g. `find <downloads dir> -mindepth 1 -maxdepth 1` for each of the video/music/podcast base directories) that no channel/artist/show subdirectories remain in any of the three download roots used during this test.

- [ ] **Step 9: Verify the queue workers were genuinely paused during the wipe, not just coincidentally idle**

This is best verified by code inspection plus the fact that Step 7 completed without any new video/track/episode appearing mid-wipe: re-read the three modified worker loops (`downloader.ts`, `musicDownloader.ts`, `podcastDownloader.ts`) to confirm the `isWipeInProgress()` check is present and correctly placed in each, matching Task 4 Step 4-6's diffs exactly.

- [ ] **Step 10: Verify a second concurrent wipe is rejected**

If feasible within the test window (the wipe may complete faster than a manual second click), confirm via code inspection that `POST /api/admin/system/wipe-all` while `isWipeInProgress()` is `true` returns a 409 (per Task 4 Step 2's route and Task 3 Step 3's `startLibraryWipe` implementation) rather than starting a second overlapping run.

- [ ] **Step 11: Confirm no other file was touched beyond this plan's scope**

Run: `cd /Users/light/Git/youkeep && git diff --stat main -- app/ server/`

Expected: exactly the files listed in this plan's File Structure table (across all 5 prior tasks' commits) — `server/utils/musicDownloader.ts`, `server/api/admin/music/artists/[id].delete.ts`, `server/utils/podcastDownloader.ts`, `server/api/admin/podcasts/shows/[id].delete.ts`, `server/utils/libraryWipe.ts`, `tests/unit/libraryWipe.test.ts`, `server/utils/downloader.ts`, `server/api/admin/system/wipe-preview.get.ts`, `server/api/admin/system/wipe-all.post.ts`, `server/api/admin/system/wipe-status.get.ts`, `app/components/settings/SettingsSystemTab.vue`, `app/pages/settings.vue`. Any other file appearing means work was done outside this plan's scope.

- [ ] **Step 12: Stop the dev server**

Stop the preview server. No commit is needed for this task.

---

## Self-Review

Run at the end of writing, against the design spec at `docs/superpowers/specs/2026-09-07-wipe-all-libraries-design.md`.

### 1. Spec coverage

| Spec requirement | Where it lands | Outcome |
|---|---|---|
| New music-artist delete logic + endpoint | Task 1 | Covered — mirrors `channels/[id].delete.ts` exactly |
| New podcast-show delete logic + endpoint | Task 2 | Covered — mirrors `channels/[id].delete.ts` exactly |
| Wipe orchestrator (preview/flag/runLibraryWipe) | Task 3 | Covered, with the pure `buildWipeReport` genuinely unit tested per the Global Constraints |
| Preview summary (counts + estimated size) | Task 3 (`getWipePreview`) + Task 5 (UI rendering) | Covered — explicitly documents the `podcast_episodes` size gap (no `size_bytes` column) rather than silently guessing |
| Typed exact-match confirmation, not `confirm()` | Task 5 Step 1-2 | Covered — button `:disabled` on exact string match |
| Background job + polling progress UI | Task 3 (`startLibraryWipe`/`getWipeProgress`) + Task 4 (status route) + Task 5 (1s polling) | Covered, matching the existing queue-polling interval convention |
| Best-effort/continue-on-failure, final success/failure report | Task 3 (`runLibraryWipeInternal` continues past each `WipeOutcome` regardless of error) + Task 5 (report rendering) | Covered |
| Wipe-in-progress flag blocks all 3 workers | Task 4 Steps 4-6 | Covered — same insertion pattern mirrored 3 times |
| Reject concurrent wipe with 409 | Task 3 (`startLibraryWipe`) + Task 4 Step 2 | Covered |
| Danger Zone placement in Settings → System | Task 5 | Covered |
| Global Constraint — no user/playlist/subscription deletion | Not touched by any task — only `channels`, `music_artists`, `podcast_shows` rows are deleted; cascades to playlist junction tables are pre-existing DB behavior, not new code | Covered |
| Global Constraint — no new single-item delete UI | Task 1/2 add endpoints only, no UI button; Task 5's UI is exclusively the bulk wipe panel | Covered |
| Global Constraint — no change to existing video/channel delete flows | Task 3's `deleteChannelForWipe` is a new, separate function that duplicates (does not modify) the existing route's logic, specifically so the existing route is untouched | Covered |
| Testing — pure logic tested, I/O logic not | Task 3 Steps 1-4 (`buildWipeReport` tests) vs. Tasks 1/2/4/5 (explicitly "Test: none") | Covered |

No gap found. Every spec section maps to a task.

### 2. Placeholder scan

Searched for `TBD`, `TODO`, `implement later`, `fill in details`, `add appropriate error handling`, `add validation`, `handle edge cases`, `write tests for the above`, `similar to Task N`, and any step describing a change without showing it.

- Every code step in Tasks 1-5 shows complete, runnable code — no fragment is left to the implementer's interpretation.
- Task 5's Step 1 template insertion point is described precisely ("the last child of `.system-dashboard-layout`, after both existing columns' content") since this plan doesn't have byte-exact current line numbers for a file it hasn't modified before — this is a legitimate "locate and insert" instruction backed by the actual current structure investigated during plan-writing, not a placeholder.
- Task 6 (verification) intentionally has no code changes — that's its nature, not an omission.

### 3. Type and signature consistency

- `WipeItemType`, `WipeOutcome`, `WipeReport`, `WipeProgress`, `WipePreview` are defined once in Task 3 and referenced identically (same field names) in Task 4's routes and Task 5's frontend `ref` types.
- `deleteMusicArtist`'s and `deletePodcastShow`'s return shape (`{success:true} | {success:false, error:string}`) is defined in Tasks 1-2 and consumed with that exact shape in Task 3's `runLibraryWipeInternal`.
- `cancelDownload`/`cancelMusicDownload`/`cancelPodcastDownload`, `getDownloadsDir`/`getMusicDownloadsDir`/`getPodcastDownloadsDir`, and `sanitizeFolderName` were all confirmed to exist with these exact names via direct file reads before being referenced in any task's code.
- The `SUPPRIMER` confirmation string is used consistently in Task 5's Steps 1-2 (template placeholder/hint text and the `:disabled` comparison) — one literal, not two different spellings.
- Test command is `npm test` → `vitest run`, matching every prior sub-project. The new unit test file (`tests/unit/libraryWipe.test.ts`) follows the exact same location and import-style convention as the existing `tests/unit/chapters.test.ts`.
