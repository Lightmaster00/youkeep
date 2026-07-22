# Concurrent Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let YouKeep's download queue worker run multiple video downloads at once, up to an admin-configurable, live-adjustable limit, instead of one at a time.

**Architecture:** The sequential `while` loop in `startQueueWorker` (`server/utils/downloader.ts`) becomes an orchestrator: each iteration checks a fresh-read concurrency setting against a dedicated active-download counter, and if there's room and pending work, marks a video `downloading` and fires off its download **without awaiting it**. The download's own success/failure handling (previously inline in the loop) moves into a new `runSingleDownload` helper that the orchestrator doesn't wait on, so one video's failure or long runtime never blocks the loop from picking up the next one.

**Tech Stack:** Nuxt 4 / Nitro server routes, better-sqlite3 (synchronous, single-threaded — no locking needed for the DB read-then-update pick), Vue 3 (Composition API) admin UI, Vitest for unit tests.

## Global Constraints

- Global concurrency limit only — no per-channel limits (per spec Non-Goals).
- Changing the limit applies live to the running worker — no restart/pause-resume required (per spec §2).
- No changes to the Queue UI's rendering of individual video cards — it already supports multiple simultaneous `downloading` rows (per spec Non-Goals).
- Default `max_concurrent_downloads` value: `2`.

---

### Task 1: Pure concurrency-decision helpers

**Files:**
- Create: `server/utils/concurrency.ts`
- Test: `tests/unit/concurrency.test.ts`

**Interfaces:**
- Produces: `DEFAULT_MAX_CONCURRENT_DOWNLOADS: number`, `parseMaxConcurrentDownloads(raw: string | undefined | null): number`, `hasCapacityForMoreDownloads(activeCount: number, maxConcurrent: number): boolean`, `isValidMaxConcurrentValue(value: unknown): value is number` — all consumed by Tasks 3, 4, and 5.

This follows the same extraction pattern already used for `server/utils/chapters.ts` (pure logic, no DB/network, tested directly with Vitest) — see `tests/unit/chapters.test.ts` for the existing convention.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/concurrency.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  parseMaxConcurrentDownloads,
  hasCapacityForMoreDownloads,
  isValidMaxConcurrentValue,
} from '../../server/utils/concurrency';

describe('parseMaxConcurrentDownloads', () => {
  it('defaults when the raw value is missing', () => {
    expect(parseMaxConcurrentDownloads(undefined)).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
    expect(parseMaxConcurrentDownloads(null)).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
  });

  it('defaults when the raw value is not a positive integer', () => {
    expect(parseMaxConcurrentDownloads('0')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
    expect(parseMaxConcurrentDownloads('-1')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
    expect(parseMaxConcurrentDownloads('abc')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
    expect(parseMaxConcurrentDownloads('')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
  });

  it('parses a valid positive integer string', () => {
    expect(parseMaxConcurrentDownloads('1')).toBe(1);
    expect(parseMaxConcurrentDownloads('5')).toBe(5);
  });
});

describe('hasCapacityForMoreDownloads', () => {
  it('returns true when active count is below the max', () => {
    expect(hasCapacityForMoreDownloads(1, 3)).toBe(true);
  });

  it('returns false when active count equals the max', () => {
    expect(hasCapacityForMoreDownloads(3, 3)).toBe(false);
  });

  it('returns false when active count exceeds the max (e.g. after lowering the setting)', () => {
    expect(hasCapacityForMoreDownloads(5, 3)).toBe(false);
  });

  it('returns true when nothing is active', () => {
    expect(hasCapacityForMoreDownloads(0, 1)).toBe(true);
  });
});

describe('isValidMaxConcurrentValue', () => {
  it('accepts positive integers', () => {
    expect(isValidMaxConcurrentValue(1)).toBe(true);
    expect(isValidMaxConcurrentValue(10)).toBe(true);
  });

  it('rejects zero and negative numbers', () => {
    expect(isValidMaxConcurrentValue(0)).toBe(false);
    expect(isValidMaxConcurrentValue(-1)).toBe(false);
  });

  it('rejects non-integers and non-numbers', () => {
    expect(isValidMaxConcurrentValue(1.5)).toBe(false);
    expect(isValidMaxConcurrentValue('3')).toBe(false);
    expect(isValidMaxConcurrentValue(null)).toBe(false);
    expect(isValidMaxConcurrentValue(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/concurrency.test.ts`
Expected: FAIL with "Cannot find module '../../server/utils/concurrency'" (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `server/utils/concurrency.ts`:

```typescript
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/concurrency.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/concurrency.ts tests/unit/concurrency.test.ts
git commit -m "feat: add pure concurrency-decision helpers for the download queue"
```

---

### Task 2: Seed the `max_concurrent_downloads` setting

**Files:**
- Modify: `server/utils/db.ts:315-323` (immediately after the existing SponsorBlock category-seeding loop)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `settings` row with `key = 'max_concurrent_downloads'` guaranteed to exist after `getDb()` first runs, for Tasks 3/4/5 to read/write.

This follows the exact seeding pattern already used for `downloader_paused` (`server/utils/db.ts:284-289`) and the SponsorBlock categories immediately above the insertion point.

- [ ] **Step 1: Add the seed block**

In `server/utils/db.ts`, immediately after this existing block (ends at line 323):

```typescript
  const sponsorBlockCategorySeeds = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'filler'];
  for (const category of sponsorBlockCategorySeeds) {
    const key = `sponsorblock_${category}`;
    const check = db.prepare('SELECT COUNT(*) as count FROM settings WHERE key = ?').get(key) as { count: number };
    if (check.count === 0) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, 'ignore');
      console.log(`Seeded setting ${key}: ignore`);
    }
  }
```

add:

```typescript
  const maxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'max_concurrent_downloads'").get() as { count: number };
  if (maxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('max_concurrent_downloads', '2')").run();
    console.log('Seeded setting max_concurrent_downloads: 2');
  }
```

- [ ] **Step 2: Verify it runs without error**

Run: `npx vitest run tests/unit/concurrency.test.ts` (sanity check nothing broke; this task has no dedicated test since it's a straightforward DB seed identical in shape to five existing ones in the same file)

Then create a throwaway verification script (same technique used earlier in this project to exercise `server/utils/*.ts` directly — see the `syncChannelPlaylists` debugging session):

```bash
cat > scratch_verify_seed.ts <<'EOF'
import { getDb } from './server/utils/db';

const db = getDb();
const row = db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_downloads'").get() as { value: string } | undefined;
console.log('max_concurrent_downloads row:', row);
EOF
npx --yes tsx scratch_verify_seed.ts
rm -f scratch_verify_seed.ts
```
Expected: prints `max_concurrent_downloads row: { value: '2' }` (either freshly seeded, printing the `Seeded setting max_concurrent_downloads: 2` log line first, or already present from a prior run) and no errors.

- [ ] **Step 3: Commit**

```bash
git add server/utils/db.ts
git commit -m "feat: seed max_concurrent_downloads setting, default 2"
```

---

### Task 3: GET endpoint for the concurrency setting

**Files:**
- Create: `server/api/admin/downloader/concurrency.get.ts`

**Interfaces:**
- Consumes: `parseMaxConcurrentDownloads` from `server/utils/concurrency.ts` (Task 1).
- Produces: `GET /api/admin/downloader/concurrency` → `{ maxConcurrentDownloads: number }`, consumed by Task 6 (settings UI).

Follows the exact pattern of `server/api/admin/downloader/sponsorblock.get.ts`.

- [ ] **Step 1: Write the endpoint**

Create `server/api/admin/downloader/concurrency.get.ts`:

```typescript
import { defineEventHandler } from 'h3';
import { parseMaxConcurrentDownloads } from '../../../utils/concurrency';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const row = db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_downloads'").get() as { value: string } | undefined;

  return { maxConcurrentDownloads: parseMaxConcurrentDownloads(row?.value) };
});
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx vue-tsc --noEmit -p .`
Expected: no new errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add server/api/admin/downloader/concurrency.get.ts
git commit -m "feat: add GET endpoint for the max concurrent downloads setting"
```

---

### Task 4: POST endpoint for the concurrency setting

**Files:**
- Create: `server/api/admin/downloader/concurrency.post.ts`

**Interfaces:**
- Consumes: `isValidMaxConcurrentValue` from `server/utils/concurrency.ts` (Task 1).
- Produces: `POST /api/admin/downloader/concurrency` with body `{ maxConcurrentDownloads: number }` → `{ success: true }` or a 400 error, consumed by Task 6 (settings UI).

Follows the validate-then-write pattern of `server/api/admin/downloader/sponsorblock.post.ts`.

- [ ] **Step 1: Write the endpoint**

Create `server/api/admin/downloader/concurrency.post.ts`:

```typescript
import { defineEventHandler, readBody, createError } from 'h3';
import { isValidMaxConcurrentValue } from '../../../utils/concurrency';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const value = body?.maxConcurrentDownloads;

  if (!isValidMaxConcurrentValue(value)) {
    throw createError({ statusCode: 400, statusMessage: 'maxConcurrentDownloads must be an integer >= 1.' });
  }

  const db = getDb();
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'max_concurrent_downloads'`).run(String(value));

  return { success: true };
});
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx vue-tsc --noEmit -p .`
Expected: no new errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add server/api/admin/downloader/concurrency.post.ts
git commit -m "feat: add POST endpoint for the max concurrent downloads setting"
```

---

### Task 5: Rewrite the orchestrator loop

**Files:**
- Modify: `server/utils/downloader.ts:1-8` (imports)
- Modify: `server/utils/downloader.ts:47-57` (global state block)
- Modify: `server/utils/downloader.ts:250-365` (the `startQueueWorker` function body)

**Interfaces:**
- Consumes: `parseMaxConcurrentDownloads`, `hasCapacityForMoreDownloads` from `server/utils/concurrency.ts` (Task 1); `downloadVideoFile(videoId: string, channelId: string): Promise<void>` (existing, unchanged, `server/utils/downloader.ts:605`); `sleepOrWakeable`, `wakeWorker`, `addLog`, `getDb` (existing, unchanged).
- Produces: `startQueueWorker` behavior change only — same exported signature (`export async function startQueueWorker(): Promise<void>`), same exported `wakeWorker`/`stopQueueWorker`/`activeProcesses`. No other file needs to change to consume this; `activeProcesses` (used by `logs.get.ts` and `cancelDownload`) is untouched.

This is the core change. The new `runSingleDownload` helper is module-private (not exported) — it carries exactly the success/failure handling that used to be inline in the loop's `try`/`catch` around `await downloadVideoFile(...)`, unchanged in content, just moved so the orchestrator doesn't wait on it.

A dedicated counter (`activeDownloadCount`, separate from the `activeProcesses` map) tracks capacity. It's needed because `downloadVideoFile` doesn't call `activeProcesses.set(videoId, child)` until after its first `await getYtdlPath()` (`server/utils/downloader.ts:608-669`) — relying on `activeProcesses.size` directly for the capacity check would leave a window, between the orchestrator committing to a video and the process actually spawning, where a fast enough loop could overshoot the limit. The dedicated counter is incremented synchronously the instant the orchestrator commits to a video (no `await` in between, so no interleaving is possible — better-sqlite3 is synchronous and Node is single-threaded) and decremented in `runSingleDownload`'s `finally`. In steady state, once downloads are actually running, `activeProcesses.size` and this counter hold the same value.

- [ ] **Step 1: Add the import**

In `server/utils/downloader.ts`, change the import block at the top (lines 1-8):

```typescript
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { Cron } from 'croner';
import { getDb } from './db';
import { parseChaptersFromInfoData, buildSponsorBlockArgs } from './chapters';
```

to:

```typescript
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { Cron } from 'croner';
import { getDb } from './db';
import { parseChaptersFromInfoData, buildSponsorBlockArgs } from './chapters';
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads } from './concurrency';
```

- [ ] **Step 2: Add the active-download counter to the global state block**

Change (lines 47-57):

```typescript
// Define global-backed state to survive development HMR module hot reloads
const _g = globalThis as any;
const G_CRON = Symbol.for('YouKeep.activeCronJob');
const G_PROCESSING = Symbol.for('YouKeep.isProcessing');
const G_SHOULD_RUN = Symbol.for('YouKeep.workerShouldRun');
const G_PROCESSES = Symbol.for('YouKeep.activeProcesses');

if (!(G_CRON in _g)) _g[G_CRON] = null;
if (!(G_PROCESSING in _g)) _g[G_PROCESSING] = false;
if (!(G_SHOULD_RUN in _g)) _g[G_SHOULD_RUN] = false;
if (!(G_PROCESSES in _g)) _g[G_PROCESSES] = new Map<string, any>();
```

to:

```typescript
// Define global-backed state to survive development HMR module hot reloads
const _g = globalThis as any;
const G_CRON = Symbol.for('YouKeep.activeCronJob');
const G_PROCESSING = Symbol.for('YouKeep.isProcessing');
const G_SHOULD_RUN = Symbol.for('YouKeep.workerShouldRun');
const G_PROCESSES = Symbol.for('YouKeep.activeProcesses');
const G_ACTIVE_DOWNLOAD_COUNT = Symbol.for('YouKeep.activeDownloadCount');

if (!(G_CRON in _g)) _g[G_CRON] = null;
if (!(G_PROCESSING in _g)) _g[G_PROCESSING] = false;
if (!(G_SHOULD_RUN in _g)) _g[G_SHOULD_RUN] = false;
if (!(G_PROCESSES in _g)) _g[G_PROCESSES] = new Map<string, any>();
if (!(G_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_ACTIVE_DOWNLOAD_COUNT] = 0;
```

Then, directly below the existing `export const activeProcesses: Map<string, any> = _g[G_PROCESSES];` line (line 87), add:

```typescript
function getActiveDownloadCount(): number { return _g[G_ACTIVE_DOWNLOAD_COUNT]; }
function incrementActiveDownloadCount() { _g[G_ACTIVE_DOWNLOAD_COUNT]++; }
function decrementActiveDownloadCount() { _g[G_ACTIVE_DOWNLOAD_COUNT] = Math.max(0, _g[G_ACTIVE_DOWNLOAD_COUNT] - 1); }
```

- [ ] **Step 3: Replace `startQueueWorker` and add `runSingleDownload`**

Replace the entire function body from `export async function startQueueWorker() {` through its closing `}` (`server/utils/downloader.ts:250-365`) with:

```typescript
export async function startQueueWorker() {
  if (getIsProcessing()) {
    // Worker already running — wake it up if it is sleeping so it checks the queue instantly
    addLog('Worker déjà en cours d\'exécution. Réveil du worker...');
    wakeWorker();
    return;
  }
  setIsProcessing(true);
  setWorkerShouldRun(true);
  addLog('Démarrage du worker de file d\'attente (mode persistant)...');

  try {
    const db = getDb();
    let consecutiveSystemErrors = 0;

    while (getWorkerShouldRun()) {
      try {
        // Check if global download is paused
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          // Don't exit — just wait and poll again when unpaused
          await sleepOrWakeable(5000);
          continue;
        }

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

        if (!video) {
          // No pending videos — sleep and poll again (don't exit)
          await sleepOrWakeable(3000);
          continue;
        }

        consecutiveSystemErrors = 0;
        addLog(`Lancement du téléchargement : "${video.title}" (ID: ${video.id})`);

        // Update status to downloading, keeping the existing progress if it exists
        db.prepare(`
          UPDATE videos 
          SET download_status = 'downloading', 
              download_progress = COALESCE(download_progress, 0), 
              download_speed = '0KB/s', 
              download_eta = '--:--', 
              last_error = null
          WHERE id = ?
        `).run(video.id);

        // Claim a capacity slot synchronously (no await between the check above and here,
        // so no other loop iteration can interleave) then launch the download without
        // awaiting it, so the orchestrator can immediately go check for more capacity/work.
        incrementActiveDownloadCount();
        runSingleDownload(video.id, video.title, video.channel_id);
      } catch (loopErr: any) {
        consecutiveSystemErrors++;
        addLog(`Erreur système dans la boucle du worker (${consecutiveSystemErrors}/5) : ${loopErr.message || loopErr}`);
        if (consecutiveSystemErrors >= 5) {
          addLog('Trop d\'erreurs système consécutives. Arrêt du worker.');
          break;
        }
        // Wait before retrying to let the database/system recover
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (err: any) {
    addLog(`Erreur générale fatale du worker : ${err.message || err}`);
  } finally {
    setIsProcessing(false);
    setWorkerShouldRun(false);
    addLog('Worker de file d\'attente arrêté.');
  }
}

/**
 * Runs a single video download to completion and updates its DB status accordingly.
 * Deliberately not awaited by the orchestrator loop in startQueueWorker: a failure or
 * long runtime here is isolated to this video and never blocks other concurrent downloads.
 */
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

- [ ] **Step 4: Type-check**

Run: `npx vue-tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Run the existing test suite**

Run: `npx vitest run`
Expected: all existing tests still PASS (this task touches no code any existing test covers directly, but confirms nothing else broke — e.g. `tests/unit/chapters.test.ts`, `tests/unit/rateLimit.test.ts`, `tests/unit/recommend.test.ts`, integration tests).

- [ ] **Step 6: Commit**

```bash
git add server/utils/downloader.ts
git commit -m "feat: run downloads concurrently up to a live-adjustable limit

The orchestrator loop in startQueueWorker now launches downloads
without awaiting them, gated by a dedicated active-download counter
checked against the max_concurrent_downloads setting on every
iteration. Per-video success/failure handling is unchanged, just
moved into a new runSingleDownload helper the loop doesn't block on."
```

---

### Task 6: Settings UI — concurrency control

**Files:**
- Modify: `app/pages/settings.vue:229-240` (queue-actions-row, template)
- Modify: `app/pages/settings.vue:937-938` (ref declarations)
- Modify: `app/pages/settings.vue:1048-1049` (add fetch/save functions near `fetchQueue`/`toggleGlobalPause`)
- Modify: `app/pages/settings.vue:1606-1613` (`onMounted`)

**Interfaces:**
- Consumes: `GET /api/admin/downloader/concurrency` and `POST /api/admin/downloader/concurrency` (Tasks 3 and 4).
- Produces: no new interface for other files — this is a leaf UI change.

- [ ] **Step 1: Add refs**

In `app/pages/settings.vue`, change:

```javascript
const isPaused = ref(false);
const pausingOrResuming = ref(false);
```

to:

```javascript
const isPaused = ref(false);
const pausingOrResuming = ref(false);
const maxConcurrentDownloads = ref(2);
const savingConcurrency = ref(false);
```

- [ ] **Step 2: Add fetch and save functions**

Immediately after the existing `toggleGlobalPause` function (ends at `app/pages/settings.vue:1063`), add:

```javascript
const fetchConcurrency = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/concurrency');
    maxConcurrentDownloads.value = data.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error('Failed to fetch concurrency setting:', err);
  }
};

const handleSaveConcurrency = async () => {
  savingConcurrency.value = true;
  try {
    await $fetch('/api/admin/downloader/concurrency', {
      method: 'POST',
      body: { maxConcurrentDownloads: maxConcurrentDownloads.value }
    });
    toast.success('Concurrency setting saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save concurrency setting.');
  } finally {
    savingConcurrency.value = false;
  }
};
```

- [ ] **Step 3: Call `fetchConcurrency` on mount**

Change:

```javascript
onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    fetchSponsorBlockSettings();
    runPolling();
  }
});
```

to:

```javascript
onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    fetchSponsorBlockSettings();
    fetchConcurrency();
    runPolling();
  }
});
```

- [ ] **Step 4: Add the control to the template**

In the `queue-actions-row` div, immediately after the closing `</button>` of the Global Pause/Resume button (`app/pages/settings.vue:240`) and before the "Sync All Channels" button, add:

```html
              <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
                <label for="max-concurrent-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
                <input
                  id="max-concurrent-downloads"
                  type="number"
                  min="1"
                  v-model.number="maxConcurrentDownloads"
                  class="form-input"
                  style="width: 64px;"
                />
                <button @click="handleSaveConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingConcurrency">
                  {{ savingConcurrency ? 'Saving...' : 'Save' }}
                </button>
              </div>
```

- [ ] **Step 5: Type-check**

Run: `npx vue-tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Manual browser verification**

Using the Browser pane (as in the prior "Sync Playlists" fix in this session):
1. Start the dev server (`.claude/launch.json` config `youkeep-dev` on port 3100 already exists from the prior session).
2. Navigate to `/settings`, Downloads tab (requires an authenticated admin session — reuse the session-row technique from the prior debugging session if no real login is available, or ask the user for admin credentials).
3. Confirm the "Max concurrent downloads" input shows `2` (the seeded default) on load.
4. Change it to `3`, click Save, confirm the success toast appears.
5. Reload the page, confirm it still shows `3` (persisted).

- [ ] **Step 7: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: add max concurrent downloads control to the settings UI"
```

---

### Task 7: End-to-end verification of concurrent downloading

**Files:** none (verification only, no code changes)

This task exercises the spec's Verification section against real yt-dlp downloads, which can't be meaningfully unit-tested. Run with a channel that has several pending videos (or manually queue 4+ videos so there's enough work to observe concurrency).

- [ ] **Step 1: Set the limit to 3 and confirm 3 concurrent downloads**

With the dev server running and at least 5 pending videos available for an active channel:
```bash
curl -s -X POST -H "Cookie: youkeep_session=<admin session id>" \
  http://localhost:3100/api/admin/downloader/concurrency \
  -H "Content-Type: application/json" -d '{"maxConcurrentDownloads": 3}'
```
Trigger the worker (e.g. via a channel sync or the existing resume endpoint) and watch:
```bash
sqlite3 data/youkeep.db "SELECT id, title, download_status FROM videos WHERE download_status = 'downloading';"
```
Expected: up to 3 rows with `download_status = 'downloading'` at once, and the Queue tab in `/settings` shows 3 cards in the "downloading" state simultaneously.

- [ ] **Step 2: Lower the limit mid-flight**

While 3 downloads are in progress, POST `{"maxConcurrentDownloads": 1}` to the same endpoint.
Expected: no new download starts until the in-flight ones finish and the active count drops to 0, then exactly one new download starts (not more).

- [ ] **Step 3: Raise the limit mid-flight**

With 1 download in progress and the limit at 1, POST `{"maxConcurrentDownloads": 3}`.
Expected: within a few seconds (next orchestrator poll), 2 more downloads start without any pause/resume action.

- [ ] **Step 4: Cancel one of several concurrent downloads**

With 3 downloads in progress, cancel one via the existing Queue UI cancel button, or directly:
```bash
curl -s -X POST -H "Cookie: youkeep_session=<admin session id>" \
  -H "Content-Type: application/json" \
  -d '{"videoId": "<id of one of the 3 in-flight videos>"}' \
  http://localhost:3100/api/admin/downloader/cancel
```
(`server/api/admin/downloader/cancel.post.ts`, existing and unchanged by this plan.)
Expected: only the cancelled video stops; the other 2 continue undisturbed.

- [ ] **Step 5: Global pause with several in flight**

With several downloads running, hit the existing Pause control.
Expected: matches today's existing pause behavior unchanged (`server/api/admin/downloader/pause.post.ts` already loops over every `downloading` row, not just one) — all in-flight downloads are cancelled and reset to `pending`; no new ones start until resumed.

- [ ] **Step 6: A single failing video doesn't affect others**

With 3 downloads in progress, if one is naturally going to fail (or simulate by using an invalid/region-blocked video id queued alongside valid ones), confirm the failing video reverts to `pending` with `last_error` set in the DB, while the other 2 continue and complete normally.

- [ ] **Step 7: Report results to the user**

Summarize pass/fail for each step above. If any step fails, return to Task 5 and fix before considering this plan complete — do not mark this task done on a partial pass.
