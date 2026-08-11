# Pipeline Coupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a combined concurrency ceiling (3) that bounds total simultaneous downloads across the video and music pipelines together (on top of, not instead of, each pipeline's own independent per-pipeline cap), and deduplicate two near-identical pairs of functions — `resetStaleDownloads`/`resetStaleMusicDownloads` and `syncAllChannels`/`syncAllMusicArtists` — into shared, parameterized implementations in `server/utils/concurrency.ts`. This reverses a previously-declined "video and music pipelines stay fully independent, no shared code at all" principle, per explicit user approval documented in the design spec at `docs/superpowers/specs/2026-08-10-pipeline-coupling-design.md`.

**Architecture:** `server/utils/concurrency.ts` remains the pipeline-agnostic home for pure/shared helpers (as it already is for `parseMaxConcurrentDownloads`, `hasCapacityForMoreDownloads`, `hasEnoughDiskSpace`). Three new exports go there: `hasCapacityForCombinedDownloads` (pure), `resetStaleDownloadsForTable` (table-parameterized, dependency-injected logger), and `runSyncAllEntities` (a generic orchestrator whose every observable side effect — every log line, every DB write, every ingest call — is supplied by the caller as a closure, so it reproduces each pipeline's *exact* current behavior rather than a new generic one). `downloader.ts`'s `startQueueWorker()` and `musicDownloader.ts`'s `startMusicQueueWorker()` each gain one additional capacity check (their own per-pipeline check stays untouched); `resetStaleDownloads()`/`resetStaleMusicDownloads()` become one-line delegations; `syncAllChannels()`/`syncAllMusicArtists()` become thin wrappers around `runSyncAllEntities()`. This is the first cross-import between `downloader.ts` and `musicDownloader.ts` (in both directions) — see "Circular Import Safety Analysis" below for why this is safe in this codebase.

**Tech Stack:** Nuxt 4, Nitro, better-sqlite3, TypeScript, Vitest

## Global Constraints

- No merge of the two worker loops themselves — combined cap is an additional guard each loop checks independently, not a shared scheduler.
- No change to either pipeline's own per-pipeline concurrency setting/UI.
- No change to `refreshCompletedVideosMetadata()` itself or any attempt to give music an equivalent step.
- No new settings-table entry or Settings-page UI for the combined cap — it's a fixed constant (`COMBINED_MAX_CONCURRENT_DOWNLOADS = 3`).
- Every existing exported function name/signature in `downloader.ts` and `musicDownloader.ts` (`resetStaleDownloads`, `resetStaleMusicDownloads`, `syncAllChannels`, `syncAllMusicArtists`) must be preserved unchanged — only their internal bodies change — so nothing outside these two files needs to change.
- `server/utils/downloader.ts` and `musicDownloader.ts` have no dedicated automated tests for their yt-dlp-spawning logic (project-wide accepted gap) — manual verification only for the syncAll refactors and the combined-cap wiring. The new pure functions in `concurrency.ts` DO get real unit tests.

## Circular Import Safety Analysis (read before Task 4/5)

Today `musicDownloader.ts` already imports from `downloader.ts` (`getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable, isFfmpegAvailable`); `downloader.ts` imports nothing from `musicDownloader.ts`. This plan makes `downloader.ts` import `getActiveMusicDownloadCount` from `musicDownloader.ts` (Task 4) — creating a genuine two-way circular import: `downloader.ts` → `musicDownloader.ts` → `downloader.ts`.

**Conclusion: this is safe**, and no workaround (passing counts as parameters, moving the counters into `concurrency.ts`) is needed. Reasoning:

1. Both `getActiveDownloadCount` (in `downloader.ts`) and `getActiveMusicDownloadCount` (in `musicDownloader.ts`) are plain `function` declarations (not `const`/arrow functions), so they are hoisted — their binding exists and is callable from the very start of their module's evaluation, before any of that module's other top-level statements run.
2. Neither function is called at module top level in either file — both are only ever invoked from inside other functions (`startQueueWorker`'s loop body, `startMusicQueueWorker`'s loop body), which only run later, long after both modules have finished their initial evaluation (Nitro/Node ESM evaluates the whole module graph once at startup before any request or worker loop runs).
3. Node's ESM circular-import handling uses live bindings resolved lazily — whichever module is entered first will, partway through its own evaluation, request the other module; since the other module's needed export is a hoisted function declaration, it is already defined at that point regardless of which module started first.

This same reasoning was checked and confirmed for the one other place this plan considered adding a new cross-import (`concurrency.ts` calling `addLog` from `downloader.ts` for the shared `resetStaleDownloadsForTable`/`runSyncAllEntities` helpers) — and deliberately avoided instead: both new `concurrency.ts` functions take their logging behavior as an injected callback parameter (`log: (msg: string) => void`, or per-event callbacks on `runSyncAllEntities`'s config) rather than importing `addLog` directly. This was **not** required for safety (the same hoisting argument would have covered it) — it was chosen because the two pipelines' current log call sites are not textually identical (see Task 3's brief), and dependency injection is the only way to reproduce each pipeline's *exact* existing log wording/logger (`addLog` for both reset functions, but `console.log` for video's `syncAllChannels` vs `addLog` for music's `syncAllMusicArtists`) without `concurrency.ts` special-casing either pipeline. As a side benefit, `concurrency.ts` stays import-free of both `downloader.ts` and `musicDownloader.ts`, so it remains the neutral, dependency-free meeting point its existing pure functions establish it as.

## Task Decomposition Note

The design spec sketched 5 tasks (2 for `concurrency.ts`'s two new helpers, 1 each for `downloader.ts`/`musicDownloader.ts`, 1 manual-verification). This plan uses **6 tasks**: the spec left "which task creates `runSyncAllEntities`" open, and reading the real code (see Task 3) showed it needs its own careful design pass distinct from `resetStaleDownloadsForTable`'s — so it gets its own task (Task 3), all three still landing in `concurrency.ts` sequentially. Tasks 4/5/6 otherwise match the spec's decomposition exactly.

---

## Task 1: `concurrency.ts` — combined concurrency cap

**Files:**
- Modify: `server/utils/concurrency.ts`
- Modify: `tests/unit/concurrency.test.ts`

**Interfaces:**
- Produces (consumed by Task 4 `downloader.ts` and Task 5 `musicDownloader.ts`): `COMBINED_MAX_CONCURRENT_DOWNLOADS: number`, `hasCapacityForCombinedDownloads(totalActiveCount: number, maxCombined: number): boolean`

- [ ] **Step 1: Add the constant and pure function**

In `server/utils/concurrency.ts`, the file currently ends (line 34) with the closing brace of `hasEnoughDiskSpace`. Append this after it:

```ts

export const COMBINED_MAX_CONCURRENT_DOWNLOADS = 3;

export function hasCapacityForCombinedDownloads(totalActiveCount: number, maxCombined: number): boolean {
  return totalActiveCount < maxCombined;
}
```

- [ ] **Step 2: Add unit tests**

In `tests/unit/concurrency.test.ts`, update the import block (lines 3–10) to add the two new names:

```ts
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  parseMaxConcurrentDownloads,
  hasCapacityForMoreDownloads,
  isValidMaxConcurrentValue,
  hasEnoughDiskSpace,
  MIN_FREE_DISK_SPACE_BYTES,
  COMBINED_MAX_CONCURRENT_DOWNLOADS,
  hasCapacityForCombinedDownloads,
} from '../../server/utils/concurrency';
```

Then append this new `describe` block at the end of the file (after the closing `});` of the `hasEnoughDiskSpace` block):

```ts

describe('hasCapacityForCombinedDownloads', () => {
  it('returns true when total active count is below the combined max', () => {
    expect(hasCapacityForCombinedDownloads(2, 3)).toBe(true);
  });

  it('returns false when total active count equals the combined max', () => {
    expect(hasCapacityForCombinedDownloads(3, 3)).toBe(false);
  });

  it('returns false when total active count exceeds the combined max (e.g. after both pipelines were already at capacity)', () => {
    expect(hasCapacityForCombinedDownloads(4, 3)).toBe(false);
  });

  it('returns true when nothing is active', () => {
    expect(hasCapacityForCombinedDownloads(0, 3)).toBe(true);
  });

  it('exports the combined cap constant as 3', () => {
    expect(COMBINED_MAX_CONCURRENT_DOWNLOADS).toBe(3);
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run tests/unit/concurrency.test.ts
```

Expect all tests (existing + new) to pass.

- [ ] **Step 4: Commit**

```bash
git add server/utils/concurrency.ts tests/unit/concurrency.test.ts
git commit -m "$(cat <<'EOF'
feat: add combined concurrency cap to concurrency.ts

COMBINED_MAX_CONCURRENT_DOWNLOADS (3) and hasCapacityForCombinedDownloads
will let both worker loops enforce a total-across-both-pipelines ceiling
on top of their existing independent per-pipeline caps.
EOF
)"
```

---

## Task 2: `concurrency.ts` — shared `resetStaleDownloadsForTable`

**Files:**
- Modify: `server/utils/concurrency.ts`
- Modify: `tests/unit/concurrency.test.ts`

**Interfaces:**
- Consumes: `Database.Database` (from the `better-sqlite3` package, already a project dependency)
- Produces (consumed by Task 4 `downloader.ts` and Task 5 `musicDownloader.ts`): `resetStaleDownloadsForTable(db: Database.Database, table: 'videos' | 'music_tracks', resetLogLabel: string, errorContext: string, log: (msg: string) => void): void`

**Design note:** The current two functions being replaced are NOT byte-identical in their log text:

```ts
// downloader.ts (current, lines 432-446)
export function resetStaleDownloads() {
  try {
    const db = getDb();
    const result = db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null
      WHERE download_status = 'downloading'
    `).run();
    if (result.changes > 0) {
      addLog(`Réinitialisation de ${result.changes} téléchargements interrompus.`);
    }
  } catch (err: any) {
    console.error('Failed to reset stale downloads:', err);
  }
}

// musicDownloader.ts (current, lines 775-789)
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

The reset-count message text differs (`"téléchargements interrompus"` vs `"téléchargements musicaux interrompus"` — not just a single-word swap), and the `console.error` prefix differs (`"Failed to reset stale downloads:"` vs `"Failed to reset stale music downloads:"`). `resetStaleDownloadsForTable` takes both full strings as parameters (`resetLogLabel`, `errorContext`) rather than trying to derive one generic label, so each call site reproduces its exact original text. It also takes `log` as a parameter (both current call sites use `addLog`, but injecting it — rather than importing `addLog` from `downloader.ts` — keeps `concurrency.ts` free of any dependency on either pipeline file; see "Circular Import Safety Analysis" above).

- [ ] **Step 1: Add the `better-sqlite3` type import**

In `server/utils/concurrency.ts`, change the top of the file from:

```ts
import fs from 'fs';
```

to:

```ts
import fs from 'fs';
import Database from 'better-sqlite3';
```

- [ ] **Step 2: Add `resetStaleDownloadsForTable`**

Append this at the end of `server/utils/concurrency.ts` (after the `hasCapacityForCombinedDownloads` block added in Task 1):

```ts

export function resetStaleDownloadsForTable(
  db: Database.Database,
  table: 'videos' | 'music_tracks',
  resetLogLabel: string,
  errorContext: string,
  log: (msg: string) => void
): void {
  try {
    const result = db.prepare(`
      UPDATE ${table}
      SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null
      WHERE download_status = 'downloading'
    `).run();
    if (result.changes > 0) {
      log(`Réinitialisation de ${result.changes} ${resetLogLabel}.`);
    }
  } catch (err: any) {
    console.error(`Failed to reset stale ${errorContext}:`, err);
  }
}
```

- [ ] **Step 3: Add unit tests**

In `tests/unit/concurrency.test.ts`, update the import block to add `resetStaleDownloadsForTable` from `concurrency`, and add the test-db helpers:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  parseMaxConcurrentDownloads,
  hasCapacityForMoreDownloads,
  isValidMaxConcurrentValue,
  hasEnoughDiskSpace,
  MIN_FREE_DISK_SPACE_BYTES,
  COMBINED_MAX_CONCURRENT_DOWNLOADS,
  hasCapacityForCombinedDownloads,
  resetStaleDownloadsForTable,
} from '../../server/utils/concurrency';
import {
  createTestDb,
  insertChannel,
  insertVideo,
  insertMusicArtist,
  insertMusicTrack,
} from '../helpers/testDb';
```

Then append this new `describe` block at the end of the file:

```ts

describe('resetStaleDownloadsForTable', () => {
  it('resets downloading videos to pending and clears progress/speed/eta', () => {
    const db = createTestDb();
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    db.prepare("UPDATE videos SET download_progress = 42, download_speed = '1MB/s', download_eta = '00:10' WHERE id = 'v1'").run();

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'videos', 'téléchargements interrompus', 'downloads', log);

    const row = db.prepare('SELECT download_status, download_progress, download_speed, download_eta FROM videos WHERE id = ?').get('v1') as any;
    expect(row.download_status).toBe('pending');
    expect(row.download_progress).toBe(0);
    expect(row.download_speed).toBeNull();
    expect(row.download_eta).toBeNull();
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements interrompus.');
  });

  it('resets downloading music tracks to pending using the music_tracks table', () => {
    const db = createTestDb();
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'music_tracks', 'téléchargements musicaux interrompus', 'music downloads', log);

    const row = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get('t1') as any;
    expect(row.download_status).toBe('pending');
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements musicaux interrompus.');
  });

  it('does not call log when no rows were changed', () => {
    const db = createTestDb();
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'completed' });

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'videos', 'téléchargements interrompus', 'downloads', log);

    expect(log).not.toHaveBeenCalled();
  });

  it('leaves unrelated rows (not in downloading status) untouched', () => {
    const db = createTestDb();
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'completed' });
    insertVideo(db, { id: 'v3', channelId: 'c1', downloadStatus: 'failed' });

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'videos', 'téléchargements interrompus', 'downloads', log);

    expect((db.prepare('SELECT download_status FROM videos WHERE id = ?').get('v2') as any).download_status).toBe('completed');
    expect((db.prepare('SELECT download_status FROM videos WHERE id = ?').get('v3') as any).download_status).toBe('failed');
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements interrompus.');
  });

  it('catches a query failure, logs to console.error, and does not throw or call log', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenDb = { prepare: () => { throw new Error('boom'); } } as any;
    const log = vi.fn();

    expect(() => resetStaleDownloadsForTable(brokenDb, 'videos', 'téléchargements interrompus', 'downloads', log)).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to reset stale downloads:', expect.any(Error));
    expect(log).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/unit/concurrency.test.ts
```

Expect all tests (existing + new) to pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/concurrency.ts tests/unit/concurrency.test.ts
git commit -m "$(cat <<'EOF'
feat: add shared resetStaleDownloadsForTable to concurrency.ts

Table-parameterized replacement for the near-identical bodies of
resetStaleDownloads (downloader.ts) and resetStaleMusicDownloads
(musicDownloader.ts). Log label/error-context text and the logger
itself are all injected so each pipeline's exact current wording is
preserved once the two call sites are wired up to delegate to this.
EOF
)"
```

---

## Task 3: `concurrency.ts` — shared `runSyncAllEntities` orchestrator

**Files:**
- Modify: `server/utils/concurrency.ts`

**Interfaces:**
- Produces (consumed by Task 4 `downloader.ts` and Task 5 `musicDownloader.ts`): `SyncAllEntitiesConfig<T>` interface, `runSyncAllEntities<T>(config: SyncAllEntitiesConfig<T>): Promise<void>`

**Design note — why this deviates from the design spec's literal sketch:** The spec's sketch (`docs/superpowers/specs/2026-08-10-pipeline-coupling-design.md`, section 3) has `runSyncAllEntities` call `addLog` directly with generic templated messages (`entityUrl`, `entityLabel`, a single `logPrefix`). Reading the two real functions being replaced shows this doesn't reproduce their actual current behavior:

```ts
// downloader.ts syncAllChannels (current, lines 1514-1558) — uses console.log/console.error, NOT addLog
export async function syncAllChannels(): Promise<void> {
  const db = getDb();
  db.prepare("UPDATE settings SET value = '1' WHERE key = 'sync_all_active'").run();
  try {
    db.prepare("UPDATE channels SET sync_status = 'downloading'").run();
    const channels = db.prepare("SELECT id, title FROM channels").all() as { id: string; title: string }[];
    console.log(`Starting metadata update for all ${channels.length} channels...`);
    for (const ch of channels) {
      const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
      if (pausedSetting?.value === '1') {
        console.log('Global sync-all task aborted: downloader is paused.');
        break;
      }
      console.log(`Updating channel: ${ch.title} (${ch.id})`);
      const url = `https://www.youtube.com/channel/${ch.id}`;
      try {
        await ingestUrl(url);
      } catch (err) {
        console.error(`Error updating channel ${ch.title} (${ch.id}):`, err);
      }
    }
    await refreshCompletedVideosMetadata();
    startQueueWorker();
    console.log('Update of all channels completed successfully.');
  } catch (err) {
    console.error('Fatal error during syncAllChannels:', err);
  } finally {
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'sync_all_active'").run();
  }
}

// musicDownloader.ts syncAllMusicArtists (current, lines 796-833) — uses addLog, checks result.success (video doesn't), sets sync_status per-artist inside the loop
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
        const result = await ingestMusicUrl(url);
        if (!result.success) {
          addLog(`Échec de la resynchronisation de l'artiste ${artist.name} (${artist.id}) : ${result.message}`);
        }
      } catch (err: any) {
        addLog(`Erreur lors de la resynchronisation de l'artiste ${artist.name} (${artist.id}) : ${err.message || err}`);
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
```

Differences beyond just logger choice: video's per-channel work never inspects `ingestUrl`'s return value (only a thrown exception is logged); music's per-artist work explicitly checks `result.success` and logs an extra line when it's `false`, and also writes `sync_status = 'downloading'` on the artist row *inside* the loop (video's equivalent — a single blanket `UPDATE channels SET sync_status = 'downloading'` — runs once, before the loop, for every channel at once, not per-channel inside it). A single templated `entityLabel`/`ingest(url)` shape cannot reproduce both without introducing a wording or behavior drift.

The orchestrator built here instead treats **only the true skeleton** as shared — set active flag, fetch entities once, iterate with a pause-check-and-break each turn, run one opaque per-entity step, run an optional post-loop hook, start the worker, reset the flag in `finally` — and pushes every observable side effect (every log call, the per-entity ingest logic including its own try/catch, the artist's per-entity `sync_status` write) into caller-supplied closures. This is a deliberate refinement beyond the spec's sketch, not an oversight: it's the only shape that lets both wrappers (Task 4, Task 5) reproduce their exact current external behavior word-for-word.

- [ ] **Step 1: Add `SyncAllEntitiesConfig` and `runSyncAllEntities`**

Append this at the end of `server/utils/concurrency.ts` (after the `resetStaleDownloadsForTable` block added in Task 2):

```ts

export interface SyncAllEntitiesConfig<T> {
  db: Database.Database;
  activeFlagSettingKey: string;
  pausedSettingKey: string;
  fetchEntities: () => T[];
  processEntity: (entity: T) => Promise<void>;
  onStart: (count: number) => void;
  onPaused: () => void;
  onComplete: () => void;
  onFatalError: (err: any) => void;
  afterLoop?: () => Promise<void>;
  startWorker: () => void;
}

export async function runSyncAllEntities<T>(config: SyncAllEntitiesConfig<T>): Promise<void> {
  const {
    db,
    activeFlagSettingKey,
    pausedSettingKey,
    fetchEntities,
    processEntity,
    onStart,
    onPaused,
    onComplete,
    onFatalError,
    afterLoop,
    startWorker,
  } = config;

  db.prepare(`UPDATE settings SET value = '1' WHERE key = ?`).run(activeFlagSettingKey);

  try {
    const entities = fetchEntities();
    onStart(entities.length);

    for (const entity of entities) {
      const pausedSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get(pausedSettingKey) as { value: string } | undefined;
      if (pausedSetting?.value === '1') {
        onPaused();
        break;
      }
      await processEntity(entity);
    }

    if (afterLoop) await afterLoop();

    startWorker();
    onComplete();
  } catch (err) {
    onFatalError(err);
  } finally {
    db.prepare(`UPDATE settings SET value = '0' WHERE key = ?`).run(activeFlagSettingKey);
  }
}
```

No unit tests for this function per the Global Constraints (DB/network-shaped orchestration, covered by Task 6's manual verification instead) — but confirm the file still compiles:

- [ ] **Step 2: Typecheck via the existing test run**

```bash
npx vitest run tests/unit/concurrency.test.ts
```

Expect all tests to still pass (this doesn't exercise `runSyncAllEntities` itself, but a TypeScript error in the file would fail the whole test file to load).

- [ ] **Step 3: Commit**

```bash
git add server/utils/concurrency.ts
git commit -m "$(cat <<'EOF'
feat: add shared runSyncAllEntities orchestrator to concurrency.ts

Generic skeleton (set active flag, iterate entities with per-iteration
pause-check, optional post-loop hook, start worker, reset flag) shared
by syncAllChannels and syncAllMusicArtists. Every log call and all
per-entity logic stay in caller-supplied closures so each pipeline's
exact current behavior (including their differing loggers and the
result.success check that only music's version has) is reproduced
exactly, not merged into one generic behavior.
EOF
)"
```

---

## Task 4: `downloader.ts` — wire combined cap, delegate reset, refactor syncAllChannels

**Files:**
- Modify: `server/utils/downloader.ts`
- Modify: `server/utils/musicDownloader.ts` (only to add one `export` keyword — see Step 1)

**Interfaces:**
- Consumes: `COMBINED_MAX_CONCURRENT_DOWNLOADS`, `hasCapacityForCombinedDownloads`, `resetStaleDownloadsForTable`, `runSyncAllEntities` (all from Tasks 1–3, `./concurrency`); `getActiveMusicDownloadCount` (from `./musicDownloader`, exported in Step 1 below)
- Produces (consumed by Task 5 `musicDownloader.ts`): `getActiveDownloadCount` becomes exported (was previously module-private)

- [ ] **Step 1: Export `getActiveMusicDownloadCount` in `musicDownloader.ts`**

In `server/utils/musicDownloader.ts` line 40, change:

```ts
function getActiveMusicDownloadCount(): number { return _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT]; }
```

to:

```ts
export function getActiveMusicDownloadCount(): number { return _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT]; }
```

This is the only change to `musicDownloader.ts` in this task — the rest of Task 4 touches only `downloader.ts`. (Task 5 does the mirror-image export of `getActiveDownloadCount` and the rest of the music-side work.)

- [ ] **Step 2: Export `getActiveDownloadCount` in `downloader.ts`**

In `server/utils/downloader.ts` line 92, change:

```ts
function getActiveDownloadCount(): number { return _g[G_ACTIVE_DOWNLOAD_COUNT]; }
```

to:

```ts
export function getActiveDownloadCount(): number { return _g[G_ACTIVE_DOWNLOAD_COUNT]; }
```

- [ ] **Step 3: Update imports in `downloader.ts`**

Change line 9 from:

```ts
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace } from './concurrency';
```

to:

```ts
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace, COMBINED_MAX_CONCURRENT_DOWNLOADS, hasCapacityForCombinedDownloads, resetStaleDownloadsForTable, runSyncAllEntities } from './concurrency';
import { getActiveMusicDownloadCount } from './musicDownloader';
```

(Adds a new import line right after the existing `./concurrency` import — this is the new circular import described in "Circular Import Safety Analysis" above.)

- [ ] **Step 4: Wire the combined-cap check into `startQueueWorker()`**

In `server/utils/downloader.ts`, inside `startQueueWorker()`, change (current lines 282–293):

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
```

to:

```ts
        // Respect the concurrency limit, read fresh every iteration so changes apply live
        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActiveDownloadCount(), maxConcurrent)) {
          await sleepOrWakeable(1000);
          continue;
        }

        // Combined ceiling across both pipelines — an additional guard on top of this
        // pipeline's own per-pipeline cap above, not a replacement for it.
        if (!hasCapacityForCombinedDownloads(getActiveDownloadCount() + getActiveMusicDownloadCount(), COMBINED_MAX_CONCURRENT_DOWNLOADS)) {
          await sleepOrWakeable(1000);
          continue;
        }

        if (!(await hasEnoughDiskSpace(getDownloadsDir()))) {
          await sleepOrWakeable(5000);
          continue;
        }
```

- [ ] **Step 5: Delegate `resetStaleDownloads()`**

Change (current lines 429–446):

```ts
/**
 * Resets any stale downloads stuck in 'downloading' status back to 'pending'
 */
export function resetStaleDownloads() {
  try {
    const db = getDb();
    const result = db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null
      WHERE download_status = 'downloading'
    `).run();
    if (result.changes > 0) {
      addLog(`Réinitialisation de ${result.changes} téléchargements interrompus.`);
    }
  } catch (err: any) {
    console.error('Failed to reset stale downloads:', err);
  }
}
```

to:

```ts
/**
 * Resets any stale downloads stuck in 'downloading' status back to 'pending'
 */
export function resetStaleDownloads() {
  resetStaleDownloadsForTable(getDb(), 'videos', 'téléchargements interrompus', 'downloads', addLog);
}
```

- [ ] **Step 6: Refactor `syncAllChannels()` to use `runSyncAllEntities`**

Change (current lines 1510–1558):

```ts
/**
 * Iterates through all channels, sets them to 'downloading',
 * runs yt-dlp metadata ingestion for each, and triggers the queue worker.
 */
export async function syncAllChannels(): Promise<void> {
  const db = getDb();
  
  // Set sync_all_active setting to '1'
  db.prepare("UPDATE settings SET value = '1' WHERE key = 'sync_all_active'").run();

  try {
    // 1. Set all channels' sync_status to 'downloading'
    db.prepare("UPDATE channels SET sync_status = 'downloading'").run();

    // 2. Fetch all channels
    const channels = db.prepare("SELECT id, title FROM channels").all() as { id: string; title: string }[];
    console.log(`Starting metadata update for all ${channels.length} channels...`);

    // 3. Re-ingest each channel's feed in sequence
    for (const ch of channels) {
      // Check if global download is paused
      const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
      if (pausedSetting?.value === '1') {
        console.log('Global sync-all task aborted: downloader is paused.');
        break;
      }

      console.log(`Updating channel: ${ch.title} (${ch.id})`);
      const url = `https://www.youtube.com/channel/${ch.id}`;
      try {
        await ingestUrl(url);
      } catch (err) {
        console.error(`Error updating channel ${ch.title} (${ch.id}):`, err);
      }
    }
    
    // 4. Refresh metadata (views, likes, comments) for recently completed videos
    await refreshCompletedVideosMetadata();
    
    // 5. Trigger queue worker to download all new pending videos
    startQueueWorker();
    console.log('Update of all channels completed successfully.');
  } catch (err) {
    console.error('Fatal error during syncAllChannels:', err);
  } finally {
    // Set sync_all_active setting to '0'
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'sync_all_active'").run();
  }
}
```

to:

```ts
/**
 * Iterates through all channels, sets them to 'downloading',
 * runs yt-dlp metadata ingestion for each, and triggers the queue worker.
 */
export async function syncAllChannels(): Promise<void> {
  const db = getDb();

  await runSyncAllEntities<{ id: string; title: string }>({
    db,
    activeFlagSettingKey: 'sync_all_active',
    pausedSettingKey: 'downloader_paused',
    fetchEntities: () => {
      // Video-only pre-loop step: mark every channel as actively downloading before
      // listing them. This runs inside runSyncAllEntities's try block (via this
      // closure), same as it did in the original inline function, so it's still
      // covered by the outer fatal-error catch and still runs after the
      // 'sync_all_active' flag is set to '1'. syncAllMusicArtists has no equivalent
      // blanket update — it sets each artist's sync_status individually inside
      // processEntity instead (see Task 5).
      db.prepare("UPDATE channels SET sync_status = 'downloading'").run();
      return db.prepare("SELECT id, title FROM channels").all() as { id: string; title: string }[];
    },
    processEntity: async (ch) => {
      console.log(`Updating channel: ${ch.title} (${ch.id})`);
      const url = `https://www.youtube.com/channel/${ch.id}`;
      try {
        await ingestUrl(url);
      } catch (err) {
        console.error(`Error updating channel ${ch.title} (${ch.id}):`, err);
      }
    },
    onStart: (count) => console.log(`Starting metadata update for all ${count} channels...`),
    onPaused: () => console.log('Global sync-all task aborted: downloader is paused.'),
    onComplete: () => console.log('Update of all channels completed successfully.'),
    onFatalError: (err) => console.error('Fatal error during syncAllChannels:', err),
    afterLoop: refreshCompletedVideosMetadata,
    startWorker: startQueueWorker,
  });
}
```

- [ ] **Step 7: Run the full test suite and build**

```bash
npm test
npm run build
```

`npm test` must show no regressions (this task doesn't add new automated tests — `downloader.ts` has none per the Global Constraints — but must not break any existing test that imports `downloader.ts`, e.g. any test that imports `musicDownloader.ts` and therefore transitively loads `downloader.ts`). `npm run build` must succeed — this is the concrete check that the new circular import between `downloader.ts` and `musicDownloader.ts` bundles cleanly under Nitro, not just under Vitest's module resolution.

- [ ] **Step 8: Commit**

```bash
git add server/utils/downloader.ts server/utils/musicDownloader.ts
git commit -m "$(cat <<'EOF'
refactor: wire combined cap and shared helpers into downloader.ts

startQueueWorker() now also checks hasCapacityForCombinedDownloads
across both pipelines' active counts (in addition to its own
per-pipeline check, unchanged). resetStaleDownloads() and
syncAllChannels() now delegate to concurrency.ts's shared
resetStaleDownloadsForTable/runSyncAllEntities, preserving their
exact prior external behavior. Exports getActiveDownloadCount and
(in musicDownloader.ts) getActiveMusicDownloadCount so each pipeline
can read the other's active count — see the plan's circular-import
safety analysis for why this cross-import is safe.
EOF
)"
```

---

## Task 5: `musicDownloader.ts` — mirror Task 4 for the music pipeline

**Files:**
- Modify: `server/utils/musicDownloader.ts`

**Interfaces:**
- Consumes: `COMBINED_MAX_CONCURRENT_DOWNLOADS`, `hasCapacityForCombinedDownloads`, `resetStaleDownloadsForTable`, `runSyncAllEntities` (from Tasks 1–3, `./concurrency`); `getActiveDownloadCount` (from `./downloader`, exported in Task 4 Step 2)

**Note on scope:** `downloadTrackClip()` (line 508) has its own separate capacity-wait loop (`while (!hasCapacityForMoreDownloads(...)) { await sleepOrWakeableMusic(1000); }`, line 521) for manual clip backfills — this is not one of the two worker loops the spec calls out (`startQueueWorker`/`startMusicQueueWorker`) and is intentionally left untouched by this task. Only `startMusicQueueWorker()`'s loop gets the combined-cap check.

- [ ] **Step 1: Update imports in `musicDownloader.ts`**

Change line 7 from:

```ts
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable, isFfmpegAvailable } from './downloader';
```

to:

```ts
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable, isFfmpegAvailable, getActiveDownloadCount } from './downloader';
```

Change line 9 from:

```ts
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace } from './concurrency';
```

to:

```ts
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace, COMBINED_MAX_CONCURRENT_DOWNLOADS, hasCapacityForCombinedDownloads, resetStaleDownloadsForTable, runSyncAllEntities } from './concurrency';
```

- [ ] **Step 2: Wire the combined-cap check into `startMusicQueueWorker()`**

In `server/utils/musicDownloader.ts`, inside `startMusicQueueWorker()`, change (current lines 583–593):

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
```

to:

```ts
        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActiveMusicDownloadCount(), maxConcurrent)) {
          await sleepOrWakeableMusic(1000);
          continue;
        }

        // Combined ceiling across both pipelines — an additional guard on top of this
        // pipeline's own per-pipeline cap above, not a replacement for it.
        if (!hasCapacityForCombinedDownloads(getActiveMusicDownloadCount() + getActiveDownloadCount(), COMBINED_MAX_CONCURRENT_DOWNLOADS)) {
          await sleepOrWakeableMusic(1000);
          continue;
        }

        if (!(await hasEnoughDiskSpace(getMusicDownloadsDir()))) {
          await sleepOrWakeableMusic(5000);
          continue;
        }
```

- [ ] **Step 3: Delegate `resetStaleMusicDownloads()`**

Change (current lines 771–789):

```ts
/**
 * Resets any stale music downloads stuck in 'downloading' status back to 'pending'.
 * Mirrors resetStaleDownloads in downloader.ts.
 */
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

to:

```ts
/**
 * Resets any stale music downloads stuck in 'downloading' status back to 'pending'.
 * Mirrors resetStaleDownloads in downloader.ts.
 */
export function resetStaleMusicDownloads() {
  resetStaleDownloadsForTable(getDb(), 'music_tracks', 'téléchargements musicaux interrompus', 'music downloads', addLog);
}
```

- [ ] **Step 4: Refactor `syncAllMusicArtists()` to use `runSyncAllEntities`**

Change (current lines 791–833):

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
        const result = await ingestMusicUrl(url);
        if (!result.success) {
          addLog(`Échec de la resynchronisation de l'artiste ${artist.name} (${artist.id}) : ${result.message}`);
        }
      } catch (err: any) {
        addLog(`Erreur lors de la resynchronisation de l'artiste ${artist.name} (${artist.id}) : ${err.message || err}`);
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
```

to:

```ts
/**
 * Re-fetches every followed music artist's channel feed to discover new
 * tracks, then starts the download queue for anything newly pending.
 * Mirrors syncAllChannels in downloader.ts.
 */
export async function syncAllMusicArtists(): Promise<void> {
  const db = getDb();

  await runSyncAllEntities<{ id: string; name: string; channel_id: string }>({
    db,
    activeFlagSettingKey: 'music_sync_all_active',
    pausedSettingKey: 'music_downloader_paused',
    fetchEntities: () => db.prepare("SELECT id, name, channel_id FROM music_artists WHERE channel_id IS NOT NULL").all() as { id: string; name: string; channel_id: string }[],
    processEntity: async (artist) => {
      addLog(`Resynchronisation de l'artiste : ${artist.name} (${artist.id})`);
      // Per-artist sync_status write, done here inside processEntity rather than as a
      // single blanket pre-loop UPDATE (contrast with syncAllChannels in downloader.ts,
      // Task 4) — this matches the original inline loop body exactly.
      db.prepare("UPDATE music_artists SET sync_status = 'downloading' WHERE id = ?").run(artist.id);

      const url = `https://www.youtube.com/channel/${artist.channel_id}`;
      try {
        const result = await ingestMusicUrl(url);
        if (!result.success) {
          addLog(`Échec de la resynchronisation de l'artiste ${artist.name} (${artist.id}) : ${result.message}`);
        }
      } catch (err: any) {
        addLog(`Erreur lors de la resynchronisation de l'artiste ${artist.name} (${artist.id}) : ${err.message || err}`);
      }
    },
    onStart: (count) => addLog(`Démarrage de la resynchronisation automatique de ${count} artiste(s) musicaux...`),
    onPaused: () => addLog('Resynchronisation automatique musicale interrompue : téléchargements en pause.'),
    onComplete: () => addLog('Resynchronisation automatique musicale terminée.'),
    onFatalError: (err) => console.error('Fatal error during syncAllMusicArtists:', err),
    // No afterLoop — syncAllMusicArtists has no equivalent of video's
    // refreshCompletedVideosMetadata() post-loop hook (Global Constraints: don't add one).
    startWorker: startMusicQueueWorker,
  });
}
```

- [ ] **Step 5: Run the full test suite and build**

```bash
npm test
npm run build
```

Both must succeed with no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/utils/musicDownloader.ts
git commit -m "$(cat <<'EOF'
refactor: wire combined cap and shared helpers into musicDownloader.ts

Mirrors the downloader.ts changes: startMusicQueueWorker() now also
checks hasCapacityForCombinedDownloads across both pipelines' active
counts; resetStaleMusicDownloads() and syncAllMusicArtists() now
delegate to concurrency.ts's shared resetStaleDownloadsForTable/
runSyncAllEntities, preserving their exact prior external behavior
(including the result.success check and per-artist sync_status write
inside the loop, which have no video-side equivalent).
EOF
)"
```

---

## Task 6: Manual verification

**Files:** none (no code changes)

This task has no automated test per the Global Constraints (`downloader.ts`/`musicDownloader.ts`'s yt-dlp-spawning logic has no dedicated automated tests project-wide). All steps are manual, run against a real local dev server with real network access to YouTube.

- [ ] **Step 1: Start the dev server with the dev-login fixture enabled**

```bash
ALLOW_DEV_LOGIN=1 npm run dev
```

Leave it running in one terminal.

- [ ] **Step 2: Log in via the dev-login fixture**

In a second terminal, capture the session cookie:

```bash
curl -i -X POST http://localhost:3000/api/dev/login -c /tmp/youkeep-dev-cookie.txt
```

Confirm the response body is `{"success":true,"username":"dev-fixture-admin"}` and `/tmp/youkeep-dev-cookie.txt` was written.

- [ ] **Step 3: Verify "Sync All Channels" still behaves identically**

Make sure at least one channel is already registered (e.g. via the Settings UI or `POST /api/admin/downloader/ingest`), then trigger:

```bash
curl -i -X POST http://localhost:3000/api/admin/downloader/sync-all -b /tmp/youkeep-dev-cookie.txt
```

Expect `{"success":true,"message":"Mise à jour globale de toutes les chaînes démarrée."}`. Watch the dev server's stdout: confirm you see `Starting metadata update for all N channels...`, then one `Updating channel: <title> (<id>)` line per channel, then `Update of all channels completed successfully.` — same wording and same `console.log` (not `addLog`/timestamped-log-line) format as before this refactor. If you pause downloads mid-run (`POST /api/admin/downloader/pause`) confirm you see `Global sync-all task aborted: downloader is paused.` and the loop stops early.

- [ ] **Step 4: Verify "Sync All Artists" still behaves identically**

There is no HTTP endpoint that triggers `syncAllMusicArtists()` today (it's currently wired to the music cron scheduler only — confirmed by grepping `server/api/` for `syncAllMusicArtists`, only `musicDownloader.ts` itself references it). Trigger it directly with `vite-node` (already available via the `vitest`/`vite` devDependency, no new tooling needed) against the real dev database:

Make sure at least one music artist is already registered and followed (`sync_status` doesn't matter — `syncAllMusicArtists` sets it itself), then create `/tmp/youkeep-verify-music-sync.ts`:

```ts
import { syncAllMusicArtists } from './server/utils/musicDownloader';

syncAllMusicArtists().then(() => {
  console.log('syncAllMusicArtists() finished.');
  process.exit(0);
}).catch((err) => {
  console.error('syncAllMusicArtists() threw:', err);
  process.exit(1);
});
```

Run it from the repo root (so its relative import resolves), while the dev server above is NOT also touching the same `data/youkeep.db` file at that exact moment to avoid `SQLITE_BUSY` noise:

```bash
npx vite-node /tmp/youkeep-verify-music-sync.ts
```

Expect to see, via the process's own `console.log` (this script doesn't wire up `addLog`'s destination — it just calls `console.log` internally, same as `addLog` does) each of: `[HH:MM:SS] Démarrage de la resynchronisation automatique de N artiste(s) musicaux...`, one `[HH:MM:SS] Resynchronisation de l'artiste : <name> (<id>)` per artist, and `[HH:MM:SS] Resynchronisation automatique musicale terminée.`, ending with `syncAllMusicArtists() finished.`. Delete `/tmp/youkeep-verify-music-sync.ts` afterward (it's a throwaway verification script, not part of the codebase).

- [ ] **Step 5: Confirm the video-only post-loop hook stays video-only**

From Step 3's dev-server log output, confirm you saw metadata-refresh activity (`addLog`'s `Metadata refresh: ...` lines from `refreshCompletedVideosMetadata()`) after the per-channel loop finished and before `Update of all channels completed successfully.`. Confirm no such `Metadata refresh:` lines appeared during Step 4's music run.

- [ ] **Step 6: Force simultaneous video + music downloads and confirm the combined cap holds**

With both pipelines' per-pipeline caps at their defaults (2 each, `max_concurrent_downloads`/`music_max_concurrent_downloads` settings), queue enough work to try to reach 4 total: add at least 3 pending videos to a channel with `sync_status = 'downloading'` and at least 3 pending tracks to an artist with `sync_status = 'downloading'`, then trigger both workers:

```bash
curl -i -X POST http://localhost:3000/api/admin/downloader/sync-all -b /tmp/youkeep-dev-cookie.txt
```

(and similarly ensure the music worker is running — e.g. via the per-artist sync endpoint `POST /api/admin/music/artists/<id>/sync`). While downloads are in flight, poll the admin queue endpoints (or watch the dev-server log for `Lancement du téléchargement` / `Lancement du téléchargement audio` lines) and confirm the sum of currently-`downloading` rows across `videos` and `music_tracks` never exceeds 3 at any observed instant, even though 2 (video) + 2 (music) = 4 would otherwise be reachable without the combined cap.

- [ ] **Step 7: Clean up**

```bash
rm -f /tmp/youkeep-dev-cookie.txt /tmp/youkeep-verify-music-sync.ts
```

Stop the dev server (Ctrl+C in the first terminal).

No commit for this task — it's verification only, confirming Tasks 1–5's changes behave identically to pre-refactor behavior in a real environment.

---

## Self-Review

**Spec coverage checklist:**
- [x] Combined cap constant + pure function — Task 1.
- [x] Combined cap wired into both worker loops (video: Task 4 Step 4; music: Task 5 Step 2) — additional guard alongside each pipeline's own unchanged check.
- [x] `resetStaleDownloadsForTable` shared function + tests — Task 2.
- [x] Both `resetStaleDownloads`/`resetStaleMusicDownloads` delegate to it, names/signatures preserved — Task 4 Step 5, Task 5 Step 3.
- [x] `runSyncAllEntities` shared orchestrator — Task 3.
- [x] Both `syncAllChannels`/`syncAllMusicArtists` refactored to use it, names/signatures preserved, video's pre-loop `sync_status` update and post-loop `refreshCompletedVideosMetadata()` hook preserved exactly, music's per-artist in-loop `sync_status` update and `result.success` check preserved exactly — Task 4 Step 6, Task 5 Step 4.
- [x] Circular-import safety explicitly analyzed and documented (not deferred to the implementer) — top-of-plan section, referenced from Tasks 4 and 5.
- [x] No settings/UI changes for the combined cap — confirmed absent from every task.
- [x] No merge of the two worker loops — each loop keeps its own independent `while` loop; only one extra `if` guard added to each.
- [x] `refreshCompletedVideosMetadata()` itself untouched, no music equivalent added — confirmed (Task 4 Step 6 calls it unchanged via `afterLoop`; Task 5 Step 4 has no `afterLoop`).
- [x] Manual verification covers: identical log format for both syncAll paths, video-only post-loop hook staying video-only, and the combined cap actually holding under simultaneous load — Task 6.

**Placeholder scan:** every code block in Tasks 1–5 is a complete, copy-pasteable function/file section (verified by having read the real current file contents for every "before" snippet — no snippet was reconstructed from the design spec's sketch without cross-checking against the actual file). No `// ... rest of function` or `/* similar to X */` markers anywhere in this document.

**Type-consistency scan across tasks:**
- `hasCapacityForCombinedDownloads(totalActiveCount: number, maxCombined: number): boolean` (Task 1) — call sites in Task 4 Step 4 and Task 5 Step 2 both pass `(sum: number, COMBINED_MAX_CONCURRENT_DOWNLOADS)`, matching.
- `resetStaleDownloadsForTable(db: Database.Database, table: 'videos' | 'music_tracks', resetLogLabel: string, errorContext: string, log: (msg: string) => void): void` (Task 2) — call sites in Task 4 Step 5 (`'videos'`) and Task 5 Step 3 (`'music_tracks'`) both pass 5 args in order, matching; both pass `addLog` (already in scope via each file's own import) as `log`.
- `SyncAllEntitiesConfig<T>`/`runSyncAllEntities<T>` (Task 3) — Task 4 Step 6 instantiates `T = { id: string; title: string }` and supplies every required field (`db`, `activeFlagSettingKey`, `pausedSettingKey`, `fetchEntities`, `processEntity`, `onStart`, `onPaused`, `onComplete`, `onFatalError`, `startWorker`) plus the optional `afterLoop`; Task 5 Step 4 instantiates `T = { id: string; name: string; channel_id: string }` and supplies every required field, omitting the optional `afterLoop` — both match the interface exactly, no missing/extra fields, no type mismatches (`fetchEntities` return type in each matches the `T` used in that call; `processEntity` param type matches `T` in each).
- `getActiveDownloadCount()`/`getActiveMusicDownloadCount()` — both are `(): number` with no params in their own file (Task 4 Step 2, Task 5 Step 1's mirror in Task 4 Step 1) and are called with no args at every new call site (Task 4 Step 4, Task 5 Step 2), matching.

No issues found; no changes needed after this review.
