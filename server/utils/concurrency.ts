import fs from 'fs';
import Database from 'better-sqlite3';
import { isModuleEnabled, isEffectivelyPaused } from './modules';
import { isShuttingDown } from './processTree';
import type { ModuleId } from './modules';

export const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 2;
export const MAX_CONCURRENT_DOWNLOADS_CEILING = 10;

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
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_CONCURRENT_DOWNLOADS_CEILING;
}

/**
 * How long a queue worker waits after `consecutiveErrors` system errors in a
 * row (database locked, disk gone...): 5 s, doubling, at most 60 s. A worker
 * never stops for good on its own; one successful iteration resets the count.
 */
export function workerErrorBackoffMs(consecutiveErrors: number): number {
  const n = Math.max(1, Math.floor(consecutiveErrors));
  return Math.min(60_000, 5_000 * 2 ** Math.min(n - 1, 10));
}

/** The settings keys of the three 'sync all running' flags. */
export const SYNC_ALL_FLAG_KEYS = ['sync_all_active', 'music_sync_all_active', 'podcast_sync_all_active'] as const;

/**
 * Clears the three 'sync all running' flags. Called at startup: a flag left
 * at '1' by a crash or restart during a sync would otherwise block every
 * later sync-all and cron run forever.
 */
export function resetSyncAllFlags(db: Database.Database, log: (msg: string) => void = console.log): void {
  try {
    const placeholders = SYNC_ALL_FLAG_KEYS.map(() => '?').join(', ');
    const result = db.prepare(`UPDATE settings SET value = '0' WHERE key IN (${placeholders}) AND value != '0'`).run(...SYNC_ALL_FLAG_KEYS);
    if (result.changes > 0) log(`Reset ${result.changes} 'sync all' flag(s) left on by an interrupted run.`);
  } catch (err) {
    console.error('Failed to reset the sync-all flags:', err);
  }
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

export function resetStaleDownloadsForTable(
  db: Database.Database,
  table: 'videos' | 'music_tracks' | 'podcast_episodes',
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
      log(`Reset ${result.changes} ${resetLogLabel}.`);
    }
  } catch (err: any) {
    console.error(`Failed to reset stale ${errorContext}:`, err);
  }
}

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
  // When set, a disabled module makes the whole run a no-op, and a module that
  // gets disabled mid-run stops the loop exactly like a pause.
  moduleId?: ModuleId;
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
    moduleId,
  } = config;

  if (moduleId && !isModuleEnabled(db, moduleId)) {
    return;
  }

  db.prepare(`UPDATE settings SET value = '1' WHERE key = ?`).run(activeFlagSettingKey);

  try {
    const entities = fetchEntities();
    onStart(entities.length);

    for (const entity of entities) {
      // Shutdown: start nothing more (a new yt-dlp would outlive the server).
      if (isShuttingDown()) return;
      const paused = moduleId
        ? isEffectivelyPaused(db, pausedSettingKey, moduleId)
        : (db.prepare('SELECT value FROM settings WHERE key = ?').get(pausedSettingKey) as { value: string } | undefined)?.value === '1';
      if (paused) {
        onPaused();
        break;
      }
      await processEntity(entity);
    }

    if (isShuttingDown()) return;
    if (afterLoop) await afterLoop();
    if (isShuttingDown()) return;

    startWorker();
    onComplete();
  } catch (err) {
    onFatalError(err);
  } finally {
    // Graceful shutdown may have closed the database under a running sync.
    try {
      if (db.open) db.prepare(`UPDATE settings SET value = '0' WHERE key = ?`).run(activeFlagSettingKey);
    } catch (err) {
      console.error(`Could not clear ${activeFlagSettingKey}:`, err);
    }
  }
}
