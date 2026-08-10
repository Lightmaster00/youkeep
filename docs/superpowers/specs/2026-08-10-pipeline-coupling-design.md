# Pipeline Coupling (Combined Cap + Sync Dedup) — Design

## Context

Twelfth sub-project of the ongoing "bug fixes" initiative — the fourth of 5 items reopened after the user explicitly asked to reconsider previously-declined audit findings ("corrige tout"). Bundles two related findings, both declined multiple times throughout this project's history specifically to preserve a "video and music download pipelines stay fully independent, no shared code at all" principle. The user has now explicitly reversed that principle for these two findings — this is a genuine architecture decision, not a bug fix.

Explored the current state:

- `server/utils/concurrency.ts` already holds pipeline-agnostic pure functions (`parseMaxConcurrentDownloads`, `hasCapacityForMoreDownloads`, `hasEnoughDiskSpace`) consumed by both `startQueueWorker()` (`server/utils/downloader.ts`) and `startMusicQueueWorker()` (`server/utils/musicDownloader.ts`) — but each worker loop applies its own independent concurrency limit, read from its own settings key, checked against its own active-count query. Nothing today bounds total simultaneous load across both pipelines: if both are maxed at their (default 2 each) per-pipeline caps, total active downloads can reach 4.
- `resetStaleDownloads()` (`downloader.ts:432`) and `resetStaleMusicDownloads()` (`musicDownloader.ts:775`) are near-identical: same `UPDATE ... SET download_status='pending', download_progress=0, download_speed=null, download_eta=null WHERE download_status='downloading'` against `videos` vs `music_tracks`, differing only in table name and a French log-message string.
- `syncAllChannels()` (`downloader.ts:1514`) and `syncAllMusicArtists()` (`musicDownloader.ts:796`) share the same skeleton: set an "X_sync_all_active" settings flag to `'1'`, fetch all entities (channels vs music artists), loop over them checking a pause-flag setting each iteration (breaking early if paused), call an ingest function per entity with try/catch-and-log, then a worker-start call, with the flag reset to `'0'` in a `finally`. The one structural difference: the video version has an extra step, `refreshCompletedVideosMetadata()`, called after the loop and before starting the queue worker — the music version has no equivalent.

## Scope

- Add a combined concurrency ceiling (3, alongside the existing independent per-pipeline caps) checked by both worker loops in addition to their own individual caps.
- Deduplicate `resetStaleDownloads`/`resetStaleMusicDownloads` into one shared, table-parameterized function.
- Deduplicate `syncAllChannels`/`syncAllMusicArtists`'s shared skeleton into one shared, config-parameterized orchestrator, with each pipeline's own entity list, ingest function, and (video-only) post-loop hook passed in as configuration.

## Non-Goals

- No merge of the two worker loops (`startQueueWorker`/`startMusicQueueWorker`) themselves — they remain two entirely separate polling loops; the combined cap is one additional guard condition each checks independently, not a shared scheduler.
- No change to either pipeline's per-pipeline concurrency setting/UI — those remain exactly as they are today; the combined cap is a new, additional ceiling, not a replacement.
- No change to `refreshCompletedVideosMetadata()` itself, or any attempt to give the music pipeline an equivalent step — the shared `syncAllChannels`/`syncAllMusicArtists` orchestrator supports this as an optional post-loop hook precisely so the video-only step stays video-only.
- No new settings-table entry or Settings-page UI for the combined cap — `COMBINED_MAX_CONCURRENT_DOWNLOADS = 3` is a fixed constant, matching the existing `MIN_FREE_DISK_SPACE_BYTES` precedent (a prior sub-project's disk-space guard), not user-configurable.

## Design

### 1. Combined concurrency cap

In `server/utils/concurrency.ts`, add:

```ts
export const COMBINED_MAX_CONCURRENT_DOWNLOADS = 3;

export function hasCapacityForCombinedDownloads(totalActiveCount: number, maxCombined: number): boolean {
  return totalActiveCount < maxCombined;
}
```

In `downloader.ts`'s `startQueueWorker()` loop, where it currently checks `hasCapacityForMoreDownloads(getActiveDownloadCount(), maxConcurrent)` before starting a new video download, add a second, independent check: `hasCapacityForCombinedDownloads(getActiveDownloadCount() + getActiveMusicDownloadCount(), COMBINED_MAX_CONCURRENT_DOWNLOADS)`. Both checks must pass to start a download. Mirror the same addition in `musicDownloader.ts`'s `startMusicQueueWorker()` loop (same combined-count expression, same constant). `getActiveMusicDownloadCount()`/`getActiveDownloadCount()` are existing functions in their respective files — `downloader.ts` will need to import `getActiveMusicDownloadCount` from `musicDownloader.ts` and vice versa (the one new cross-file dependency this sub-project introduces, in both directions — acceptable per the user's explicit scope approval, and the only coupling point besides the two shared helpers below).

### 2. `resetStaleDownloadsForTable` (shared)

New function in `server/utils/concurrency.ts` (the established neutral meeting-point for pipeline-agnostic helpers):

```ts
export function resetStaleDownloadsForTable(db: Database, table: 'videos' | 'music_tracks', entityLabelFr: string): void {
  try {
    const result = db.prepare(`
      UPDATE ${table}
      SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null
      WHERE download_status = 'downloading'
    `).run();
    if (result.changes > 0) {
      addLog(`Réinitialisation de ${result.changes} ${entityLabelFr} interrompu(s).`);
    }
  } catch (err: any) {
    console.error(`Failed to reset stale downloads (${table}):`, err);
  }
}
```

`resetStaleDownloads()` in `downloader.ts` becomes `export function resetStaleDownloads() { resetStaleDownloadsForTable(getDb(), 'videos', 'téléchargement'); }`; `resetStaleMusicDownloads()` in `musicDownloader.ts` becomes `export function resetStaleMusicDownloads() { resetStaleDownloadsForTable(getDb(), 'music_tracks', 'téléchargement musical'); }`. Both existing exported function names and call sites are preserved unchanged — only their bodies become one-line delegations, so nothing outside these two files needs to change.

### 3. `runSyncAllEntities` (shared orchestrator)

New function in `server/utils/concurrency.ts`:

```ts
export interface SyncAllEntitiesConfig<T> {
  db: Database;
  activeFlagSettingKey: string;
  pausedSettingKey: string;
  fetchEntities: () => T[];
  entityUrl: (entity: T) => string;
  entityLabel: (entity: T) => string; // for logging
  ingest: (url: string) => Promise<{ success: boolean; message?: string }>;
  onEntityError?: (entity: T, err: any) => void;
  afterLoop?: () => Promise<void>; // e.g. refreshCompletedVideosMetadata, video-only
  startWorker: () => void;
  logPrefix: string; // distinguishes video/music log lines, e.g. "channels" vs "artistes musicaux"
}

export async function runSyncAllEntities<T>(config: SyncAllEntitiesConfig<T>): Promise<void> {
  const { db, activeFlagSettingKey, pausedSettingKey, fetchEntities, entityUrl, entityLabel, ingest, onEntityError, afterLoop, startWorker, logPrefix } = config;

  db.prepare(`UPDATE settings SET value = '1' WHERE key = ?`).run(activeFlagSettingKey);

  try {
    const entities = fetchEntities();
    addLog(`Démarrage de la resynchronisation de ${entities.length} ${logPrefix}...`);

    for (const entity of entities) {
      const pausedSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get(pausedSettingKey) as { value: string } | undefined;
      if (pausedSetting?.value === '1') {
        addLog(`Resynchronisation de ${logPrefix} interrompue : téléchargements en pause.`);
        break;
      }

      addLog(`Resynchronisation : ${entityLabel(entity)}`);
      try {
        const result = await ingest(entityUrl(entity));
        if (!result.success) {
          addLog(`Échec de la resynchronisation de ${entityLabel(entity)} : ${result.message}`);
        }
      } catch (err: any) {
        addLog(`Erreur lors de la resynchronisation de ${entityLabel(entity)} : ${err.message || err}`);
        onEntityError?.(entity, err);
      }
    }

    if (afterLoop) await afterLoop();

    startWorker();
    addLog(`Resynchronisation de ${logPrefix} terminée.`);
  } catch (err) {
    console.error(`Fatal error during sync-all (${logPrefix}):`, err);
  } finally {
    db.prepare(`UPDATE settings SET value = '0' WHERE key = ?`).run(activeFlagSettingKey);
  }
}
```

`syncAllChannels()` in `downloader.ts` becomes a thin wrapper: it performs the pre-loop `UPDATE channels SET sync_status = 'downloading'` step (which has no music equivalent — `syncAllMusicArtists` doesn't set an artist-level `sync_status` before the loop, only per-artist inside it) itself, *before* calling `runSyncAllEntities` with a `fetchEntities` closure over the channels query — that pre-loop step is specific to the video pipeline's channel model and doesn't belong in the shared orchestrator. `syncAllMusicArtists()` similarly does its own per-artist `sync_status = 'downloading'` update *inside* its `ingest` callback (since the original code sets it per-artist inside the loop, right before calling `ingestMusicUrl`, not once before the whole loop) — the shared orchestrator's `ingest` callback signature accommodates this by letting each pipeline's own closure do whatever per-entity setup it needs before calling the real ingest function.

Both wrappers preserve their exact current external behavior and exported function names/signatures — this is a pure internal refactor of their bodies.

## Error Handling

No new error-handling behavior — every `try/catch`/log-on-error pattern in the original two functions is preserved, just relocated into the shared orchestrator's callback-invocation sites. The combined-cap check follows the same pattern as the existing per-pipeline cap check: a boolean gate in the worker loop, no new error path.

## Verification

`server/utils/downloader.ts`/`musicDownloader.ts` have no dedicated automated tests for their yt-dlp-spawning logic (project-wide, previously established convention — manual verification only for that class of code in these two files). The new pure functions in `concurrency.ts` (`hasCapacityForCombinedDownloads`, `resetStaleDownloadsForTable`) are plain, DB/network-free logic and should get real unit tests, matching this codebase's existing test coverage for `concurrency.ts`'s other pure functions (check `tests/` for the existing `hasCapacityForMoreDownloads`/`hasEnoughDiskSpace` test file and follow its exact pattern). `runSyncAllEntities` is harder to unit-test in isolation given its DB/network dependencies — verify it manually via the dev-login fixture: trigger a real "Sync All Channels" and a real "Sync All Artists" action from Settings and confirm both complete with identical behavior to before this refactor (same log messages format, same pause-checking behavior, same worker-start at the end), and specifically confirm the video-only `refreshCompletedVideosMetadata()` step still only runs for the video sync, never the music one. For the combined cap, verify manually by forcing both pipelines to have active downloads simultaneously (e.g. queue several video downloads and several music downloads at once) and confirming total concurrent active downloads never exceeds 3, even though each pipeline's own individual cap (2 each) would otherwise allow up to 4 combined.
