# Reliability Batch 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disk-space check before starting downloads in both pipelines, and expose a manual pause/resume toggle for channels and music artists so a bulk "resync all" can be reverted per-item.

**Architecture:** A shared `hasEnoughDiskSpace()` helper in `server/utils/concurrency.ts`, wired into both queue workers' main loops. A new music-artist pause endpoint mirroring the existing (but currently unwired) video-channel one. Two small UI additions reusing existing action-button patterns in `channels.vue` and `settings.vue`.

**Tech Stack:** Nuxt 4, Nitro (H3), better-sqlite3, Vue 3 Composition API, Vitest, Node's built-in `fs.promises.statfs`.

## Global Constraints

- No combined video+music concurrency cap.
- No playlist-import queue-size limit.
- No fix for Shorts under-detection in ordinary playlists.
- No changes to the cron "resync all"'s own bulk-flip behavior — this batch only adds the missing manual revert.
- `MIN_FREE_DISK_SPACE_BYTES = 500 * 1024 * 1024` (500 MB), user's explicit choice.
- The disk-space check fails open (treats a check failure as "enough space") rather than blocking the queue over an inability to check.
- `server/utils/downloader.ts` and `server/utils/musicDownloader.ts` have zero automated test coverage for their yt-dlp-spawning queue-worker logic — Tasks 2 and 3 are manual-verification-only. This codebase has zero Vue component test infrastructure — Tasks 5 and 6 are manual-verification-only. Tasks 1 and 4 are plain testable logic with no yt-dlp involvement and get full automated test coverage.

---

### Task 1: `hasEnoughDiskSpace()` helper

**Files:**
- Modify: `server/utils/concurrency.ts`
- Test: `tests/unit/concurrency.test.ts` (new)

**Interfaces:**
- Produces: `MIN_FREE_DISK_SPACE_BYTES: number` and `hasEnoughDiskSpace(dirPath: string): Promise<boolean>`, exported from `server/utils/concurrency.ts`. Tasks 2 and 3 import and call `hasEnoughDiskSpace`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/concurrency.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { hasEnoughDiskSpace, MIN_FREE_DISK_SPACE_BYTES } from '../../server/utils/concurrency';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hasEnoughDiskSpace', () => {
  it('returns true when free space is above the threshold', async () => {
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({
      bavail: 10_000_000,
      bsize: 1024, // 10,000,000 * 1024 bytes = ~9.5 GB free, well above 500 MB
    } as any);

    const result = await hasEnoughDiskSpace('/some/dir');
    expect(result).toBe(true);
  });

  it('returns false when free space is below the threshold', async () => {
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({
      bavail: 100,
      bsize: 1024, // 100 * 1024 bytes = ~100 KB free, well below 500 MB
    } as any);

    const result = await hasEnoughDiskSpace('/some/dir');
    expect(result).toBe(false);
  });

  it('returns true (fails open) when statfs throws', async () => {
    vi.spyOn(fs.promises, 'statfs').mockRejectedValue(new Error('ENOENT'));

    const result = await hasEnoughDiskSpace('/nonexistent/dir');
    expect(result).toBe(true);
  });

  it('exports the 500 MB threshold constant', () => {
    expect(MIN_FREE_DISK_SPACE_BYTES).toBe(500 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/concurrency.test.ts`
Expected: FAIL — `hasEnoughDiskSpace`/`MIN_FREE_DISK_SPACE_BYTES` are not exported yet.

- [ ] **Step 3: Add the helper**

`server/utils/concurrency.ts` currently reads in full:

```ts
export const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 2;

export function parseMaxConcurrentDownloads(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_CONCURRENT_DOWNLOADS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENT_DOWNLOADS;
  return parsed;
}

export function hasCapacityForMoreDownloads(activeCount: number, maxConcurrent: number): boolean {
  return activeCount < maxConcurrent;
}

export function isValidMaxConcurrentValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
```

Add the new helper at the end, plus the `fs` import at the top:

```ts
import fs from 'fs';

export const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 2;

export function parseMaxConcurrentDownloads(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_CONCURRENT_DOWNLOADS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENT_DOWNLOADS;
  return parsed;
}

export function hasCapacityForMoreDownloads(activeCount: number, maxConcurrent: number): boolean {
  return activeCount < maxConcurrent;
}

export function isValidMaxConcurrentValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/concurrency.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test -- --run`
Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/utils/concurrency.ts tests/unit/concurrency.test.ts
git commit -m "feat: add hasEnoughDiskSpace helper"
```

---

### Task 2: Wire the disk-space check into the video queue worker

**Files:**
- Modify: `server/utils/downloader.ts`

**Interfaces:**
- Consumes: `hasEnoughDiskSpace` from Task 1 (import from `./concurrency`, alongside the existing `parseMaxConcurrentDownloads`/`hasCapacityForMoreDownloads` import already in this file).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the helper**

Find the existing import line (search for `from './concurrency'`) and add `hasEnoughDiskSpace` to it:

```ts
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace } from './concurrency';
```

- [ ] **Step 2: Add the check to the main loop**

`startQueueWorker()`'s loop currently reads (lines 282-302):

```ts
        // Respect the concurrency limit, read fresh every iteration so changes apply live
        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActiveDownloadCount(), maxConcurrent)) {
          await sleepOrWakeable(1000);
          continue;
        }

        // Find next pending video from active channels or manually queued, respecting priority and resuming partial downloads first
        const video = db.prepare(`
          SELECT v.id, v.title, v.channel_id
          FROM videos v
          JOIN channels c ON v.channel_id = c.id
          WHERE v.download_status = 'pending' AND (c.sync_status = 'downloading' OR v.is_manually_queued = 1)
          ORDER BY
            v.priority DESC,
            v.is_short DESC,
            CASE WHEN v.download_progress > 0 THEN 0 ELSE 1 END,
            v.created_at ASC
          LIMIT 1
        `).get() as { id: string; title: string; channel_id: string } | undefined;
```

Insert the disk-space check between the concurrency check and the video query:

```ts
        // Respect the concurrency limit, read fresh every iteration so changes apply live
        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActiveDownloadCount(), maxConcurrent)) {
          await sleepOrWakeable(1000);
          continue;
        }

        if (!(await hasEnoughDiskSpace(getDownloadsDir()))) {
          await sleepOrWakeable(5000);
          continue;
        }

        // Find next pending video from active channels or manually queued, respecting priority and resuming partial downloads first
        const video = db.prepare(`
          SELECT v.id, v.title, v.channel_id
          FROM videos v
          JOIN channels c ON v.channel_id = c.id
          WHERE v.download_status = 'pending' AND (c.sync_status = 'downloading' OR v.is_manually_queued = 1)
          ORDER BY
            v.priority DESC,
            v.is_short DESC,
            CASE WHEN v.download_progress > 0 THEN 0 ELSE 1 END,
            v.created_at ASC
          LIMIT 1
        `).get() as { id: string; title: string; channel_id: string } | undefined;
```

`getDownloadsDir()` is already defined and exported later in this same file — no new import needed, it's in scope as a function declared in the same module.

- [ ] **Step 3: Manual verification**

This function has zero automated test coverage (consistent with every prior sub-project touching this file) — verify manually instead:

1. Temporarily lower `MIN_FREE_DISK_SPACE_BYTES` in `server/utils/concurrency.ts` to a value guaranteed to be above your actual free disk space (e.g. a huge number like `Number.MAX_SAFE_INTEGER`), OR find a way to simulate low disk space in your environment.
2. Start the dev server, queue a video, confirm the queue worker logs show it waiting (via the 5-second sleep loop) instead of starting a download.
3. Revert the temporary threshold change.
4. Confirm with the normal 500 MB threshold, a video queued on a system with plenty of free space downloads normally, unaffected by this change.

If simulating low disk space isn't practical in your environment, confirm via code reading that the check is correctly placed and reads real `statfs` data, and report honestly that live low-disk-space simulation wasn't performed.

- [ ] **Step 4: Commit**

```bash
git add server/utils/downloader.ts
git commit -m "feat: pause video queue worker when disk space is low"
```

---

### Task 3: Wire the disk-space check into the music queue worker

**Files:**
- Modify: `server/utils/musicDownloader.ts`

**Interfaces:**
- Consumes: `hasEnoughDiskSpace` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the helper**

Find the existing import line (search for `from './concurrency'`) and add `hasEnoughDiskSpace`:

```ts
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace } from './concurrency';
```

- [ ] **Step 2: Add the check to the main loop**

`startMusicQueueWorker()`'s loop currently reads (lines 583-599):

```ts
        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActiveMusicDownloadCount(), maxConcurrent)) {
          await sleepOrWakeableMusic(1000);
          continue;
        }

        const track = db.prepare(`
          SELECT t.id, t.title, t.artist_id
          FROM music_tracks t
          JOIN music_artists a ON t.artist_id = a.id
          WHERE t.download_status = 'pending' AND a.sync_status = 'downloading'
          ORDER BY
            CASE WHEN t.download_progress > 0 THEN 0 ELSE 1 END,
            t.created_at ASC
          LIMIT 1
        `).get() as { id: string; title: string; artist_id: string } | undefined;
```

Insert the disk-space check between the concurrency check and the track query:

```ts
        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActiveMusicDownloadCount(), maxConcurrent)) {
          await sleepOrWakeableMusic(1000);
          continue;
        }

        if (!(await hasEnoughDiskSpace(getMusicDownloadsDir()))) {
          await sleepOrWakeableMusic(5000);
          continue;
        }

        const track = db.prepare(`
          SELECT t.id, t.title, t.artist_id
          FROM music_tracks t
          JOIN music_artists a ON t.artist_id = a.id
          WHERE t.download_status = 'pending' AND a.sync_status = 'downloading'
          ORDER BY
            CASE WHEN t.download_progress > 0 THEN 0 ELSE 1 END,
            t.created_at ASC
          LIMIT 1
        `).get() as { id: string; title: string; artist_id: string } | undefined;
```

`getMusicDownloadsDir()` is already defined and exported earlier in this same file — no new import needed.

- [ ] **Step 3: Manual verification**

Same approach as Task 2's Step 3, applied to the music pipeline: temporarily adjust the threshold (or find another way to simulate low disk space), confirm the music queue worker waits instead of downloading; revert; confirm normal operation with plenty of free space.

- [ ] **Step 4: Commit**

```bash
git add server/utils/musicDownloader.ts
git commit -m "feat: pause music queue worker when disk space is low"
```

---

### Task 4: New music artist pause endpoint

**Files:**
- Create: `server/api/admin/music/artists/[id]/pause.post.ts`
- Test: `tests/integration/music-artist-pause.test.ts` (new)

**Interfaces:**
- Produces: `POST /api/admin/music/artists/:id/pause` — flips `music_artists.sync_status` to `'paused'`. Consumed by Task 6's new UI button.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-artist-pause.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import pauseHandler from '../../server/api/admin/music/artists/[id]/pause.post';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('POST /api/admin/music/artists/:id/pause', () => {
  it('returns 401 for a guest', async () => {
    await expect(pauseHandler(mockEvent(undefined, { path: '/api/admin/music/artists/a1/pause', params: { id: 'a1' } }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs('u1', 'user');
    await expect(pauseHandler(mockEvent(cookie, { path: '/api/admin/music/artists/a1/pause', params: { id: 'a1' } }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 when the artist does not exist', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(pauseHandler(mockEvent(cookie, { path: '/api/admin/music/artists/nope/pause', params: { id: 'nope' } }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('flips sync_status to paused for an existing artist', async () => {
    insertMusicArtist(db, { id: 'a1' });
    db.prepare("UPDATE music_artists SET sync_status = 'downloading' WHERE id = 'a1'").run();

    const cookie = loginAs('admin1', 'admin');
    const result: any = await pauseHandler(mockEvent(cookie, { path: '/api/admin/music/artists/a1/pause', params: { id: 'a1' } }));

    expect(result.success).toBe(true);
    const row = db.prepare("SELECT sync_status FROM music_artists WHERE id = 'a1'").get() as any;
    expect(row.sync_status).toBe('paused');
  });
});
```

If `insertMusicArtist` doesn't default to a `sync_status` value that's easy to override, check its actual signature first (read `tests/helpers/testDb.ts`) and adapt — this test manually sets `sync_status = 'downloading'` via a follow-up `UPDATE` regardless, so it doesn't depend on the helper's default.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-artist-pause.test.ts`
Expected: FAIL — `Cannot find module '../../server/api/admin/music/artists/[id]/pause.post'` (the endpoint doesn't exist yet).

- [ ] **Step 3: Create the endpoint**

Mirror the existing video channel pause endpoint (`server/api/admin/channels/[id]/pause.post.ts`) exactly, which currently reads:

```ts
import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();
  const res = db.prepare(`
    UPDATE channels 
    SET sync_status = 'paused'
    WHERE id = ?
  `).run(channelId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  return { success: true };
});
```

Create `server/api/admin/music/artists/[id]/pause.post.ts` as the music-adapted mirror:

```ts
import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const db = getDb();
  const res = db.prepare(`
    UPDATE music_artists 
    SET sync_status = 'paused'
    WHERE id = ?
  `).run(artistId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }

  return { success: true };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-artist-pause.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test -- --run`
Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/api/admin/music/artists/[id]/pause.post.ts tests/integration/music-artist-pause.test.ts
git commit -m "feat: add music artist pause endpoint"
```

---

### Task 5: Pause/Resume button in the channel detail view

**Files:**
- Modify: `app/pages/channels.vue`

**Interfaces:**
- Consumes: existing `POST /api/admin/channels/:id/pause` and existing `POST /api/admin/channels/:id/sync` endpoints (both already exist and are unchanged by this plan).

- [ ] **Step 1: Add the toggle function**

The file already has `handleToggleSubscription` (around line 1097) as the pattern to mirror:

```ts
const handleToggleSubscription = async () => {
  if (!channelId.value) return;
  const endpoint = subscribed.value ? 'unsubscribe' : 'subscribe';
  try {
    await $fetch(`/api/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    subscribed.value = !subscribed.value;
    toast.success(subscribed.value ? 'Subscription saved.' : 'Subscription removed.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};
```

Add a new function right after it:

```ts
const togglingSyncStatus = ref(false);

const handleToggleSyncStatus = async () => {
  if (!channelId.value || !channel.value) return;
  togglingSyncStatus.value = true;
  const isPaused = channel.value.sync_status !== 'downloading';
  const endpoint = isPaused ? 'sync' : 'pause';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    toast.success(isPaused ? 'Sync resumed.' : 'Sync paused.');
    await refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  } finally {
    togglingSyncStatus.value = false;
  }
};
```

`refreshSingleChannel` is the existing `useFetch` refresh function already used elsewhere in this file (e.g. after other admin actions around lines 1148/1161/1178) — it re-fetches `singleChannelData`, which `channel` is derived from, so the badge updates reactively after the call.

- [ ] **Step 2: Add the button**

The `.channel-actions-row` currently reads (lines 42-61):

```html
          <div class="channel-actions-row">
            <button 
              @click="handleToggleSubscription" 
              class="btn subscribe-btn"
              :class="subscribed ? 'btn-secondary' : 'btn-primary'"
            >
              <svg v-if="subscribed" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>{{ subscribed ? 'Subscribed' : "Subscribe" }}</span>
            </button>
            <button 
              v-if="isAdmin"
              @click="showDrawer = true" 
              class="btn btn-secondary settings-trigger-btn"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.5 1z"></path></svg>
              <span>Tracking options</span>
            </button>

          </div>
```

Add the new toggle button after the "Tracking options" button, still inside `.channel-actions-row`:

```html
          <div class="channel-actions-row">
            <button 
              @click="handleToggleSubscription" 
              class="btn subscribe-btn"
              :class="subscribed ? 'btn-secondary' : 'btn-primary'"
            >
              <svg v-if="subscribed" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>{{ subscribed ? 'Subscribed' : "Subscribe" }}</span>
            </button>
            <button 
              v-if="isAdmin"
              @click="showDrawer = true" 
              class="btn btn-secondary settings-trigger-btn"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.5 1z"></path></svg>
              <span>Tracking options</span>
            </button>
            <button
              v-if="isAdmin"
              @click="handleToggleSyncStatus"
              class="btn btn-secondary"
              :disabled="togglingSyncStatus"
            >
              <span>{{ channel.sync_status === 'downloading' ? 'Pause Sync' : 'Resume Sync' }}</span>
            </button>

          </div>
```

- [ ] **Step 3: Manual verification**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server, navigate to a channel detail page as an admin.
2. Confirm the new button reads "Pause Sync" when the badge shows "Sync Active", and "Resume Sync" when it shows "Sync Paused".
3. Click it. Confirm the badge updates to reflect the new state, and a success toast appears.
4. Click it again to toggle back. Confirm it round-trips correctly.
5. Confirm this new button doesn't affect the existing "Subscribe"/"Tracking options" buttons' behavior.

Report what you observed.

- [ ] **Step 4: Commit**

```bash
git add app/pages/channels.vue
git commit -m "feat: add pause/resume sync toggle to channel detail view"
```

---

### Task 6: Pause button in the music artist list

**Files:**
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes: `POST /api/admin/music/artists/:id/pause` from Task 4. Reuses the existing `POST /api/admin/music/artists/:id/sync` for the resume direction (already wired to the existing "Sync" button — no change needed there).

- [ ] **Step 1: Add the pause handler**

The file already has `handleSyncMusicArtist` (around line 1583) as the pattern to mirror:

```ts
const handleSyncMusicArtist = async (artistId: string) => {
  syncingArtistId.value = artistId;
  try {
    await $fetch(`/api/admin/music/artists/${artistId}/sync`, { method: 'POST' });
    toast.success('Artist sync started.');
    setTimeout(() => fetchMusicQueue(), 3000);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to sync artist.');
  } finally {
    syncingArtistId.value = null;
  }
};
```

Add a new function right after it, and a new ref alongside the existing `syncingArtistId` ref (around line 1293):

```ts
const pausingArtistId = ref<string | null>(null);

const handlePauseMusicArtist = async (artistId: string) => {
  pausingArtistId.value = artistId;
  try {
    await $fetch(`/api/admin/music/artists/${artistId}/pause`, { method: 'POST' });
    toast.success('Artist sync paused.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to pause artist.');
  } finally {
    pausingArtistId.value = null;
  }
};
```

(No `setTimeout` delay before refreshing, unlike the sync handler — a pause takes effect immediately in the DB, unlike a sync which kicks off background work that takes a moment to reflect in the queue state.)

- [ ] **Step 2: Add the button**

The per-artist row currently ends with (lines 714-722):

```html
                      </p>
                    </div>
                    <button
                      @click="handleSyncMusicArtist(artist.id)"
                      class="btn btn-primary btn-xs"
                      :disabled="syncingArtistId === artist.id"
                    >
                      {{ syncingArtistId === artist.id ? 'Syncing...' : 'Sync' }}
                    </button>
                  </div>
```

Add the new pause button, shown only when the artist is actively syncing, right after the existing Sync button:

```html
                      </p>
                    </div>
                    <button
                      @click="handleSyncMusicArtist(artist.id)"
                      class="btn btn-primary btn-xs"
                      :disabled="syncingArtistId === artist.id"
                    >
                      {{ syncingArtistId === artist.id ? 'Syncing...' : 'Sync' }}
                    </button>
                    <button
                      v-if="artist.sync_status === 'downloading'"
                      @click="handlePauseMusicArtist(artist.id)"
                      class="btn btn-secondary btn-xs"
                      :disabled="pausingArtistId === artist.id"
                    >
                      {{ pausingArtistId === artist.id ? 'Pausing...' : 'Pause' }}
                    </button>
                  </div>
```

- [ ] **Step 3: Manual verification**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server, navigate to Settings' Music Ingestion panel as an admin, with at least one followed artist.
2. Confirm the "Pause" button only appears for an artist whose status is "downloading" (actively syncing).
3. Click "Pause". Confirm the artist's status updates to reflect the pause, the "Pause" button disappears (since `sync_status` is no longer `'downloading'`), and a success toast appears.
4. Click "Sync" on that same artist. Confirm it resumes (status flips back to "downloading"), and the "Pause" button reappears.

Report what you observed.

- [ ] **Step 4: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: add pause button for music artists in Settings"
```
