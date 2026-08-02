# Automatic Music Resync Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give followed music artists the same automatic-resync capability the video pipeline already has for channels, so new tracks are discovered without an admin manually clicking "sync" on every artist.

**Architecture:** A new `syncAllMusicArtists()` function in `server/utils/musicDownloader.ts` mirrors the existing `syncAllChannels()` in `server/utils/downloader.ts` field-for-field. A new `initMusicScheduler()`, mirroring `initScheduler()`, registers a `croner` cron job (its own independent schedule/enable settings and its own module-level active-job handle) that calls it periodically. Two new admin endpoints and a settings UI panel expose the schedule to the admin, structurally identical to the existing video scheduling UI.

**Tech Stack:** Nuxt 4 / Nitro (H3), better-sqlite3, `croner`, Vue 3 Composition API, Vitest.

## Global Constraints

- `music_sync_cron_enabled` defaults `'0'`, `music_sync_cron_schedule` defaults `'30 3 * * *'` (deliberately offset 30 minutes from the video cron's `'0 3 * * *'` default so both jobs don't hit `yt-dlp` concurrently if an admin enables both with their defaults), `music_sync_all_active` defaults `'0'`.
- `syncAllMusicArtists()` only targets followed artists (`music_artists.channel_id IS NOT NULL`) — feat-only artists (`channel_id IS NULL`) are never included.
- The music cron respects `music_downloader_paused`, checked before each artist in the loop (breaking early if paused), exactly mirroring how `syncAllChannels()` checks `downloader_paused`.
- A per-artist `ingestMusicUrl` failure is logged and the loop continues to the next artist — never aborts the whole run.
- The music cron's active-job handle, enable/schedule settings, and reentrancy guard are entirely separate from the video cron's — starting, stopping, or restarting one must never affect the other.
- No per-artist pause/resume feature is added — out of scope (see spec's Non-Goals).
- `server/utils/musicDownloader.ts` and `server/utils/downloader.ts` have zero automated test coverage for their download-execution logic (they spawn real `yt-dlp` processes). This plan does not attempt end-to-end tests for `syncAllMusicArtists()` or `initMusicScheduler()` — only the two new admin endpoints get Vitest coverage.
- Production endpoint files call project-local utilities (`getDb`, `requireAdmin`, etc.) as bare ambient identifiers via Nitro's runtime auto-import. Vitest's direct-handler-import tests don't get that transform — write the failing test first and let the failure name the exact relative import path; never pre-guess it.
- The only command that actually type-checks this repo is `npx vue-tsc -b --noEmit` (plain `vue-tsc --noEmit -p .` is a silent no-op here). Two pre-existing, unrelated errors always appear and must be distinguished from new ones: `app/components/VideoPlayer.vue(276,43)` TS2532 and `app/pages/subscriptions.vue(17,21)` TS2339.
- `tests/helpers/testDb.ts`'s `mockEvent(cookieHeader?, {path?, params?, body?, headers?})` stores `body` under `Symbol.for('h3ParsedBody')`, matching h3's internal `ParsedBodySymbol`, so `readBody(event)` returns it directly.

---

### Task 1: Settings — seed `music_sync_cron_enabled`, `music_sync_cron_schedule`, `music_sync_all_active`

**Files:**
- Modify: `server/utils/db.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: three new settings rows, seeded with defaults on first run. Consumed by Task 2 (reads them) and Task 3 (reads/writes them).

- [ ] **Step 1: Add the seed block**

Open `server/utils/db.ts`. Find the existing video cron seed block:

```ts
  const cronScheduleCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'sync_cron_schedule'").get() as { count: number };
  if (cronScheduleCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('sync_cron_schedule', '0 3 * * *')").run();
    console.log('Seeded setting sync_cron_schedule: 0 3 * * *');
  }
```

Add immediately after it:

```ts
  const cronScheduleCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'sync_cron_schedule'").get() as { count: number };
  if (cronScheduleCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('sync_cron_schedule', '0 3 * * *')").run();
    console.log('Seeded setting sync_cron_schedule: 0 3 * * *');
  }

  const musicSyncAllCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_sync_all_active'").get() as { count: number };
  if (musicSyncAllCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_all_active', '0')").run();
    console.log('Seeded setting music_sync_all_active: 0');
  }

  const musicCronEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_sync_cron_enabled'").get() as { count: number };
  if (musicCronEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_cron_enabled', '0')").run();
    console.log('Seeded setting music_sync_cron_enabled: 0');
  }

  const musicCronScheduleCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_sync_cron_schedule'").get() as { count: number };
  if (musicCronScheduleCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_cron_schedule', '30 3 * * *')").run();
    console.log('Seeded setting music_sync_cron_schedule: 30 3 * * *');
  }
```

- [ ] **Step 2: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all existing tests still pass (this is a pure additive seed, no existing code reads these keys yet).

- [ ] **Step 3: Commit**

```bash
git add server/utils/db.ts
git commit -m "feat: seed music resync cron settings"
```

---

### Task 2: `syncAllMusicArtists()` and `initMusicScheduler()` — core cron logic

**Files:**
- Modify: `server/utils/musicDownloader.ts`
- Modify: `server/plugins/scheduler.ts`

**Interfaces:**
- Consumes: `music_sync_cron_enabled`/`music_sync_cron_schedule`/`music_sync_all_active`/`music_downloader_paused` settings (Task 1 seeds the first three; `music_downloader_paused` already exists), `ingestMusicUrl` (existing, same file), `startMusicQueueWorker` (existing, same file).
- Produces: exported `syncAllMusicArtists(): Promise<void>` and exported `initMusicScheduler(): void`. Consumed by Task 3 (`initMusicScheduler` is called after a settings write to restart the job).

**Testing note:** neither function is unit-testable end-to-end (real `yt-dlp` spawning, real `croner` job registration) — no test infra exists for this class of code in this repo (`server/utils/downloader.ts`'s equivalent `syncAllChannels`/`initScheduler` have none either). This task has no automated tests; verify manually per Step 4, and skip that step explicitly (noting it in your report) if this sandbox lacks a working `yt-dlp`/network — do not fabricate results.

- [ ] **Step 1: Add the `Cron` import and a separate active-job handle**

Open `server/utils/musicDownloader.ts`. Find the top of the file:

```ts
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from './db';
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable, isFfmpegAvailable } from './downloader';
import { parseMusicMetadataFromInfoData } from './musicMetadata';
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads } from './concurrency';

// Define global-backed state to survive development HMR module hot reloads,
// same pattern as downloader.ts's own worker state.
const _g = globalThis as any;
const G_MUSIC_PROCESSING = Symbol.for('YouKeep.isMusicProcessing');
const G_MUSIC_SHOULD_RUN = Symbol.for('YouKeep.musicWorkerShouldRun');
const G_MUSIC_ACTIVE_DOWNLOAD_COUNT = Symbol.for('YouKeep.activeMusicDownloadCount');
const G_MUSIC_PROCESSES = Symbol.for('YouKeep.activeMusicProcesses');
const G_MUSIC_DOWNLOAD_START_TIMES = Symbol.for('YouKeep.activeMusicDownloadStartTimes');
const G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT = Symbol.for('YouKeep.musicClipBackfillsInFlight');

if (!(G_MUSIC_PROCESSING in _g)) _g[G_MUSIC_PROCESSING] = false;
if (!(G_MUSIC_SHOULD_RUN in _g)) _g[G_MUSIC_SHOULD_RUN] = false;
if (!(G_MUSIC_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT] = 0;
if (!(G_MUSIC_PROCESSES in _g)) _g[G_MUSIC_PROCESSES] = new Map<string, any>();
if (!(G_MUSIC_DOWNLOAD_START_TIMES in _g)) _g[G_MUSIC_DOWNLOAD_START_TIMES] = new Map<string, number>();
if (!(G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT in _g)) _g[G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT] = new Set<string>();
```

Replace with:

```ts
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Cron } from 'croner';
import { getDb } from './db';
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable, isFfmpegAvailable } from './downloader';
import { parseMusicMetadataFromInfoData } from './musicMetadata';
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads } from './concurrency';

// Define global-backed state to survive development HMR module hot reloads,
// same pattern as downloader.ts's own worker state.
const _g = globalThis as any;
const G_MUSIC_PROCESSING = Symbol.for('YouKeep.isMusicProcessing');
const G_MUSIC_SHOULD_RUN = Symbol.for('YouKeep.musicWorkerShouldRun');
const G_MUSIC_ACTIVE_DOWNLOAD_COUNT = Symbol.for('YouKeep.activeMusicDownloadCount');
const G_MUSIC_PROCESSES = Symbol.for('YouKeep.activeMusicProcesses');
const G_MUSIC_DOWNLOAD_START_TIMES = Symbol.for('YouKeep.activeMusicDownloadStartTimes');
const G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT = Symbol.for('YouKeep.musicClipBackfillsInFlight');
// Deliberately a SEPARATE symbol from downloader.ts's G_CRON — the music and
// video cron jobs must be independently startable/stoppable, never sharing
// a handle (stopping one must never stop the other).
const G_MUSIC_CRON = Symbol.for('YouKeep.activeMusicCronJob');

if (!(G_MUSIC_PROCESSING in _g)) _g[G_MUSIC_PROCESSING] = false;
if (!(G_MUSIC_SHOULD_RUN in _g)) _g[G_MUSIC_SHOULD_RUN] = false;
if (!(G_MUSIC_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT] = 0;
if (!(G_MUSIC_PROCESSES in _g)) _g[G_MUSIC_PROCESSES] = new Map<string, any>();
if (!(G_MUSIC_DOWNLOAD_START_TIMES in _g)) _g[G_MUSIC_DOWNLOAD_START_TIMES] = new Map<string, number>();
if (!(G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT in _g)) _g[G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT] = new Set<string>();
if (!(G_MUSIC_CRON in _g)) _g[G_MUSIC_CRON] = null;

function getActiveMusicCronJob(): Cron | null { return _g[G_MUSIC_CRON]; }
function setActiveMusicCronJob(val: Cron | null) { _g[G_MUSIC_CRON] = val; }
```

- [ ] **Step 2: Add `syncAllMusicArtists()` and `initMusicScheduler()`**

Open `server/utils/musicDownloader.ts` and find the end of `resetStaleMusicDownloads` (the last function in the file):

```ts
export function resetStaleMusicDownloads() {
  try {
    const db = getDb();
    const result = db.prepare(`
      UPDATE music_tracks
      SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null
      WHERE download_status = 'downloading'
    `).run();
    if (result.changes > 0) {
      addLog(`Réinitialisation de ${result.changes} téléchargements musicaux interrompus.`);
    }
  } catch (err: any) {
    console.error('Failed to reset stale music downloads:', err);
  }
}
```

Add immediately after it:

```ts
/**
 * Re-fetches every followed music artist's channel feed to discover new
 * tracks, then starts the download queue for anything newly pending.
 * Mirrors syncAllChannels in downloader.ts.
 */
export async function syncAllMusicArtists(): Promise<void> {
  const db = getDb();

  db.prepare("UPDATE settings SET value = '1' WHERE key = 'music_sync_all_active'").run();

  try {
    const artists = db.prepare("SELECT id, name, channel_id FROM music_artists WHERE channel_id IS NOT NULL").all() as { id: string; name: string; channel_id: string }[];
    addLog(`Démarrage de la resynchronisation automatique de ${artists.length} artiste(s) musicaux...`);

    for (const artist of artists) {
      const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
      if (pausedSetting?.value === '1') {
        addLog('Resynchronisation automatique musicale interrompue : téléchargements en pause.');
        break;
      }

      addLog(`Resynchronisation de l'artiste : ${artist.name} (${artist.id})`);
      db.prepare("UPDATE music_artists SET sync_status = 'downloading' WHERE id = ?").run(artist.id);

      const url = `https://www.youtube.com/channel/${artist.channel_id}`;
      try {
        await ingestMusicUrl(url);
      } catch (err) {
        console.error(`Erreur lors de la resynchronisation de l'artiste ${artist.name} (${artist.id}):`, err);
      }
    }

    startMusicQueueWorker();
    addLog('Resynchronisation automatique musicale terminée.');
  } catch (err) {
    console.error('Fatal error during syncAllMusicArtists:', err);
  } finally {
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'music_sync_all_active'").run();
  }
}

/**
 * Registers (or re-registers, on settings change) the music resync cron
 * job. Mirrors initScheduler in downloader.ts, using a separate settings
 * namespace and active-job handle so it never interacts with the video
 * cron.
 */
export function initMusicScheduler(): void {
  const db = getDb();

  const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_enabled'").get() as { value: string } | undefined;
  const scheduleSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_schedule'").get() as { value: string } | undefined;

  const enabled = enabledSetting ? enabledSetting.value === '1' : false;
  const cronExpression = scheduleSetting?.value || '30 3 * * *';

  if (getActiveMusicCronJob()) {
    getActiveMusicCronJob()!.stop();
    setActiveMusicCronJob(null);
  }

  if (enabled) {
    console.log(`Scheduling music auto-sync cron job with expression: "${cronExpression}"`);
    try {
      const job = new Cron(cronExpression, async () => {
        console.log('Automated music cron trigger: starting artist synchronization...');
        const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_all_active'").get() as { value: string } | undefined;
        if (syncSetting?.value === '1') {
          console.log('Automated music cron: sync all is already active. Skipping.');
          return;
        }
        await syncAllMusicArtists();
      });
      setActiveMusicCronJob(job);
    } catch (err) {
      console.error(`Failed to register music cron expression "${cronExpression}":`, err);
    }
  } else {
    console.log('Automated music sync cron job is disabled.');
  }
}
```

If the file fails to compile or a manual smoke test fails with a "not defined" error for `ingestMusicUrl` or `startMusicQueueWorker`, note that both are already defined earlier in this same file (not imports) — this would indicate a genuine ordering/scoping bug to fix, not a missing import.

- [ ] **Step 3: Wire `initMusicScheduler()` into startup**

Open `server/plugins/scheduler.ts`. Find:

```ts
import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { initScheduler, resetStaleDownloads, startQueueWorker, updateYtdl } from '../utils/downloader';
import { resetStaleMusicDownloads, startMusicQueueWorker } from '../utils/musicDownloader';

export default defineNitroPlugin((nitroApp) => {
  console.log('YouKeep Scheduler Plugin: Initializing background cron jobs...');
  initScheduler();
```

Replace with:

```ts
import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { initScheduler, resetStaleDownloads, startQueueWorker, updateYtdl } from '../utils/downloader';
import { resetStaleMusicDownloads, startMusicQueueWorker, initMusicScheduler } from '../utils/musicDownloader';

export default defineNitroPlugin((nitroApp) => {
  console.log('YouKeep Scheduler Plugin: Initializing background cron jobs...');
  initScheduler();
  initMusicScheduler();
```

- [ ] **Step 4: Manual verification**

With a real, writable `yt-dlp`/network environment (skip and note explicitly if unavailable in this sandbox — do not fabricate results):
1. Follow at least one music artist (or use an existing one from prior sub-project testing).
2. `sqlite3 data/youkeep.db "UPDATE settings SET value='1' WHERE key='music_sync_cron_enabled'; UPDATE settings SET value='* * * * *' WHERE key='music_sync_cron_schedule';"` (every-minute schedule, for fast testing only).
3. Restart the dev server (so `server/plugins/scheduler.ts` re-runs and picks up the enabled cron) and watch the logs for `Scheduling music auto-sync cron job with expression: "* * * * *"` followed by, within a minute, `Automated music cron trigger: starting artist synchronization...`.
4. Confirm the followed artist's `sync_status` flips to `'downloading'` and any newly-discovered tracks appear as `pending` then get downloaded.
5. Reset the schedule back: `sqlite3 data/youkeep.db "UPDATE settings SET value='0' WHERE key='music_sync_cron_enabled'; UPDATE settings SET value='30 3 * * *' WHERE key='music_sync_cron_schedule';"`.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 6: Commit**

```bash
git add server/utils/musicDownloader.ts server/plugins/scheduler.ts
git commit -m "feat: add automatic resync cron for followed music artists"
```

---

### Task 3: Admin endpoints — `GET`/`POST /api/admin/music/schedule`

**Files:**
- Create: `server/api/admin/music/schedule.get.ts`
- Create: `server/api/admin/music/schedule.post.ts`
- Test: `tests/integration/music-schedule.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (existing, `server/utils/auth.ts`), `initMusicScheduler` (Task 2, `server/utils/musicDownloader.ts`), `Cron` (from `croner`, for expression validation).
- Produces: `GET /api/admin/music/schedule` → `{ enabled: boolean, schedule: string }`. `POST /api/admin/music/schedule` → `{ success: true }`. Consumed by Task 4 (client UI calls these by URL, not by import).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-schedule.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/admin/music/schedule.get';
import postHandler from '../../server/api/admin/music/schedule.post';
import * as musicDownloader from '../../server/utils/musicDownloader';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

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

describe('GET /api/admin/music/schedule', () => {
  it('returns 401 for a guest', async () => {
    await expect(getHandler(mockEvent(undefined, { path: '/api/admin/music/schedule' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs('u1', 'user');
    await expect(getHandler(mockEvent(cookie, { path: '/api/admin/music/schedule' }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('defaults to disabled with the default schedule when no settings rows exist', async () => {
    const cookie = loginAs('admin1', 'admin');
    const result: any = await getHandler(mockEvent(cookie, { path: '/api/admin/music/schedule' }));
    expect(result).toEqual({ enabled: false, schedule: '30 3 * * *' });
  });

  it('reflects persisted settings', async () => {
    insertSetting(db, { key: 'music_sync_cron_enabled', value: '1' });
    insertSetting(db, { key: 'music_sync_cron_schedule', value: '0 * * * *' });
    const cookie = loginAs('admin1', 'admin');
    const result: any = await getHandler(mockEvent(cookie, { path: '/api/admin/music/schedule' }));
    expect(result).toEqual({ enabled: true, schedule: '0 * * * *' });
  });
});

describe('POST /api/admin/music/schedule', () => {
  it('returns 401 for a guest', async () => {
    await expect(postHandler(mockEvent(undefined, { path: '/api/admin/music/schedule', body: { enabled: true, schedule: '0 3 * * *' } }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs('u1', 'user');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/music/schedule', body: { enabled: true, schedule: '0 3 * * *' } }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 when enabled is true but schedule is missing', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/music/schedule', body: { enabled: true, schedule: '' } }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns 400 for an invalid cron expression when enabled', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/music/schedule', body: { enabled: true, schedule: 'not a cron expression' } }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('persists settings and calls initMusicScheduler for a valid, enabled schedule', async () => {
    const spy = vi.spyOn(musicDownloader, 'initMusicScheduler').mockImplementation(() => {});
    const cookie = loginAs('admin1', 'admin');

    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/music/schedule', body: { enabled: true, schedule: '0 4 * * *' } }));

    expect(result).toEqual({ success: true });
    const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_enabled'").get() as { value: string };
    const scheduleRow = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_schedule'").get() as { value: string };
    expect(enabledRow.value).toBe('1');
    expect(scheduleRow.value).toBe('0 4 * * *');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('persists a disabled schedule without validating a schedule string', async () => {
    const spy = vi.spyOn(musicDownloader, 'initMusicScheduler').mockImplementation(() => {});
    const cookie = loginAs('admin1', 'admin');

    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/music/schedule', body: { enabled: false, schedule: '' } }));

    expect(result).toEqual({ success: true });
    const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_enabled'").get() as { value: string };
    expect(enabledRow.value).toBe('0');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-schedule.test.ts`
Expected: FAIL with module-not-found errors for both handler imports.

- [ ] **Step 3: Implement the read endpoint**

Create `server/api/admin/music/schedule.get.ts`:

```ts
import { defineEventHandler } from 'h3';
import { requireAdmin } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_enabled'").get() as { value: string } | undefined;
  const scheduleSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_schedule'").get() as { value: string } | undefined;

  return {
    enabled: enabledSetting ? enabledSetting.value === '1' : false,
    schedule: scheduleSetting?.value || '30 3 * * *'
  };
});
```

- [ ] **Step 4: Implement the write endpoint**

Create `server/api/admin/music/schedule.post.ts`:

```ts
import { defineEventHandler, readBody, createError } from 'h3';
import { Cron } from 'croner';
import { requireAdmin } from '../../../utils/auth';
import { initMusicScheduler } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { enabled, schedule } = body;

  if (enabled && !schedule) {
    throw createError({ statusCode: 400, statusMessage: 'Cron schedule expression is required when enabled.' });
  }

  if (enabled) {
    try {
      new Cron(schedule);
    } catch (err) {
      throw createError({ statusCode: 400, statusMessage: `Expression cron invalide : ${err}` });
    }
  }

  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'music_sync_cron_enabled'").run(enabled ? '1' : '0');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'music_sync_cron_schedule'").run(schedule || '30 3 * * *');

  initMusicScheduler();

  return { success: true };
});
```

If the test run fails with a "not defined" error for `getDb`, add the exact explicit relative import the failure demands.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-schedule.test.ts`
Expected: PASS (all 9 tests: 4 GET + 5 POST).

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 7: Commit**

```bash
git add server/api/admin/music/schedule.get.ts server/api/admin/music/schedule.post.ts tests/integration/music-schedule.test.ts
git commit -m "feat: add admin endpoints for the music resync cron schedule"
```

---

### Task 4: Settings UI — scheduling form in the Music tab

**Files:**
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes: `GET`/`POST /api/admin/music/schedule` (Task 3).
- Produces: nothing consumed by a later task (last task in this plan).

**No automated tests for this task** — this repo has no Vue component test infrastructure. Verify manually per Step 5.

- [ ] **Step 1: Add the scheduling form to the template**

Open `app/pages/settings.vue`. Find the end of the "Music Ingestion" panel's `queue-actions-row` div and the panel's closing tag:

```html
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
          </div>
```

Replace with:

```html
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

            <form @submit.prevent="handleSaveMusicSchedule" class="policy-form-block mt-3 pt-3 border-t">
              <div class="form-group">
                <label class="checkbox-container">
                  <input type="checkbox" v-model="musicScheduleForm.enabled" />
                  <span class="checkmark"></span>
                  Enable background artist resync automation
                </label>
              </div>

              <div v-if="musicScheduleForm.enabled" class="schedule-settings-row mt-2">
                <div class="form-group flex-1">
                  <label class="form-label" for="music-preset">Preset Interval</label>
                  <select id="music-preset" v-model="musicScheduleForm.preset" @change="applyMusicPreset" class="form-select">
                    <option value="hourly">Hourly (Every hour)</option>
                    <option value="twelve_hours">Every 12 hours</option>
                    <option value="daily">Daily (resync at 3:30 AM)</option>
                    <option value="weekly">Weekly (Sunday at 3:30 AM)</option>
                    <option value="custom">Custom Cron Expression</option>
                  </select>
                </div>

                <div class="form-group flex-1" v-if="musicScheduleForm.preset === 'custom'">
                  <label class="form-label" for="music-cron">Cron Expression</label>
                  <input type="text" id="music-cron" v-model="musicScheduleForm.schedule" class="form-input" placeholder="*/30 * * * *" required />
                </div>
              </div>

              <div class="form-actions mt-3">
                <button type="submit" class="btn btn-secondary-dark" :disabled="savingMusicSchedule">
                  {{ savingMusicSchedule ? 'Saving...' : 'Save Sync Trigger' }}
                </button>
              </div>
            </form>
            <div v-if="musicScheduleMessage" class="form-msg mt-3 success-msg">
              {{ musicScheduleMessage }}
            </div>
          </div>
```

(Note: the panel's own closing `</div>` moved down by one level to now close after the new form/message — this matches exactly how the video Downloads tab's equivalent panel is structured, where the scheduling form and its message live inside the same panel as the pause/concurrency row, not in a separate panel.)

- [ ] **Step 2: Add the script state and functions**

Find the existing `handleSaveMusicConcurrency` function:

```ts
const handleSaveMusicConcurrency = async () => {
  savingMusicConcurrency.value = true;
  try {
    await $fetch('/api/admin/music/concurrency', {
      method: 'POST',
      body: { maxConcurrentDownloads: maxConcurrentMusicDownloads.value }
    });
    toast.success('Music concurrency setting saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save music concurrency setting.');
  } finally {
    savingMusicConcurrency.value = false;
  }
};
```

Add immediately after it:

```ts
const savingMusicSchedule = ref(false);
const musicScheduleMessage = ref('');

const musicScheduleForm = reactive({
  enabled: false,
  preset: 'daily',
  schedule: '30 3 * * *'
});

const musicPresets: Record<string, string> = {
  hourly: '0 * * * *',
  twelve_hours: '0 */12 * * *',
  daily: '30 3 * * *',
  weekly: '30 3 * * 0'
};

const applyMusicPreset = () => {
  if (musicScheduleForm.preset !== 'custom') {
    musicScheduleForm.schedule = musicPresets[musicScheduleForm.preset] || '30 3 * * *';
  }
};

const fetchMusicSchedule = async () => {
  try {
    const data = await $fetch<any>('/api/admin/music/schedule');
    musicScheduleForm.enabled = data.enabled;
    musicScheduleForm.schedule = data.schedule || '30 3 * * *';

    const foundPreset = Object.keys(musicPresets).find(k => musicPresets[k] === musicScheduleForm.schedule);
    musicScheduleForm.preset = foundPreset || 'custom';
  } catch (err) {
    console.error('Failed to fetch music schedule:', err);
  }
};

const handleSaveMusicSchedule = async () => {
  savingMusicSchedule.value = true;
  musicScheduleMessage.value = '';
  try {
    await $fetch('/api/admin/music/schedule', {
      method: 'POST',
      body: {
        enabled: musicScheduleForm.enabled,
        schedule: musicScheduleForm.schedule
      }
    });
    musicScheduleMessage.value = 'Music synchronization frequency saved successfully.';
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingMusicSchedule.value = false;
  }
};
```

- [ ] **Step 3: Fetch the schedule on mount**

Find the `onMounted` block:

```ts
onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    fetchSponsorBlockSettings();
    fetchConcurrency();
    runPolling();
    fetchMusicConcurrency();
    runMusicPolling();
    fetchMusicModuleEnabled();
    fetchMusicDownloadClipsEnabled();
  }
});
```

Replace with:

```ts
onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    fetchSponsorBlockSettings();
    fetchConcurrency();
    runPolling();
    fetchMusicConcurrency();
    runMusicPolling();
    fetchMusicModuleEnabled();
    fetchMusicDownloadClipsEnabled();
    fetchMusicSchedule();
  }
});
```

- [ ] **Step 4: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones (`app/components/VideoPlayer.vue(276,43)` TS2532, `app/pages/subscriptions.vue(17,21)` TS2339).

- [ ] **Step 5: Manual verification**

1. Start the dev server, log in as admin, go to Settings → Music, confirm a new "Enable background artist resync automation" checkbox appears below the pause/resume + concurrency row, unchecked by default.
2. Check it, confirm the preset dropdown appears (defaulting to "Daily (resync at 3:30 AM)"), select "Custom Cron Expression", enter `*/15 * * * *`, save, confirm a success message and that reloading the page shows the saved state.
3. Confirm the existing video Downloads tab's own scheduling form is unaffected by any of this (still shows its own independent enabled/schedule state).
4. Confirm `npx vue-tsc -b --noEmit` stays clean and `npm test -- --run` still passes in full.

- [ ] **Step 6: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: add music resync scheduling UI to Settings"
```
