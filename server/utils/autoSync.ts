import type Database from 'better-sqlite3';
import { Cron } from 'croner';
import { isEffectivelyPaused, isModuleEnabled, type ModuleId } from './modules';
import { isShuttingDown } from './processTree';
import { cronScheduleProblem } from './validation';

// Automatic synchronisation of the three libraries: default schedules, the
// last-sync bookkeeping, the startup catch-up and the status read by the
// Settings page. Nothing here imports the downloaders (they import this file);
// the startup catch-up receives the sync-all functions from its caller.

export type SyncType = 'video' | 'music' | 'podcast';
export const SYNC_TYPES: SyncType[] = ['video', 'music', 'podcast'];

export interface SyncTypeConfig {
  moduleId: ModuleId;
  label: string;
  enabledKey: string;
  scheduleKey: string;
  /** The schedule seeded for new installs and set by the auto_sync_default_v1 migration. */
  defaultSchedule: string;
  /** The schedule older versions seeded: replaced by the new default, never treated as a custom choice. */
  legacyDefaultSchedule: string;
  activeFlagKey: string;
  pausedKey: string;
  lastSyncKey: string;
  lastStartedKey: string;
}

export const SYNC_TYPE_CONFIG: Record<SyncType, SyncTypeConfig> = {
  video: {
    moduleId: 'video',
    label: 'video',
    enabledKey: 'sync_cron_enabled',
    scheduleKey: 'sync_cron_schedule',
    defaultSchedule: '0 */6 * * *',
    legacyDefaultSchedule: '0 3 * * *',
    activeFlagKey: 'sync_all_active',
    pausedKey: 'downloader_paused',
    lastSyncKey: 'video_last_sync_at',
    lastStartedKey: 'video_last_sync_started_at',
  },
  music: {
    moduleId: 'music',
    label: 'music',
    enabledKey: 'music_sync_cron_enabled',
    scheduleKey: 'music_sync_cron_schedule',
    defaultSchedule: '30 */6 * * *',
    legacyDefaultSchedule: '30 3 * * *',
    activeFlagKey: 'music_sync_all_active',
    pausedKey: 'music_downloader_paused',
    lastSyncKey: 'music_last_sync_at',
    lastStartedKey: 'music_last_sync_started_at',
  },
  podcast: {
    moduleId: 'podcasts',
    label: 'podcast',
    enabledKey: 'podcast_sync_cron_enabled',
    scheduleKey: 'podcast_sync_cron_schedule',
    defaultSchedule: '45 */6 * * *',
    legacyDefaultSchedule: '0 4 * * *',
    activeFlagKey: 'podcast_sync_all_active',
    pausedKey: 'podcast_downloader_paused',
    lastSyncKey: 'podcast_last_sync_at',
    lastStartedKey: 'podcast_last_sync_started_at',
  },
};

export const AUTO_SYNC_MIGRATION_KEY = 'auto_sync_default_v1';
/** A catch-up sync never starts sooner than this after the last one, whatever the schedule. */
export const MIN_CATCH_UP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How long after boot the catch-up sync starts (the server settles first). */
export const STARTUP_CATCH_UP_DELAY_MS = 60_000;

type Db = Pick<Database.Database, 'prepare'>;

function readSetting(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function writeSetting(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/**
 * One-time migration (new and existing installs): turns the three automatic
 * syncs on. A schedule the admin chose is kept; a missing schedule or the one
 * older versions seeded becomes the new default. Guarded by
 * auto_sync_default_v1, so a sync the admin disables afterwards stays off.
 */
export function applyAutoSyncDefaults(db: Db, log: (msg: string) => void = console.log): void {
  if (readSetting(db, AUTO_SYNC_MIGRATION_KEY) === '1') return;
  for (const type of SYNC_TYPES) {
    const cfg = SYNC_TYPE_CONFIG[type];
    const stored = readSetting(db, cfg.scheduleKey)?.trim();
    if (!stored || stored === cfg.legacyDefaultSchedule) writeSetting(db, cfg.scheduleKey, cfg.defaultSchedule);
    writeSetting(db, cfg.enabledKey, '1');
  }
  writeSetting(db, AUTO_SYNC_MIGRATION_KEY, '1');
  log('Automatic sync turned on for videos, music and podcasts (one-time default).');
}

/** Called when a sync-all run starts (manual, scheduled or catch-up). */
export function recordSyncStarted(db: Db, type: SyncType, now = Date.now()): void {
  writeSetting(db, SYNC_TYPE_CONFIG[type].lastStartedKey, String(now));
}

/** Called when a sync-all run finishes its loop (every source done, or some failed). */
export function recordSyncFinished(db: Db, type: SyncType, now = Date.now()): void {
  writeSetting(db, SYNC_TYPE_CONFIG[type].lastSyncKey, String(now));
}

function readEpoch(db: Db, key: string): number | null {
  const raw = readSetting(db, key);
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The next runs of a usable schedule after `from`, or [] for an unusable one.
 * `utc` evaluates the expression in UTC (no daylight-saving jumps), for
 * measuring its interval; the scheduler itself runs it in local time.
 */
function nextRuns(schedule: string, count: number, from: Date, utc = false): Date[] {
  if (cronScheduleProblem(schedule)) return [];
  try {
    const job = new Cron(schedule.trim(), utc ? { paused: true, timezone: 'Etc/UTC' } : { paused: true });
    const runs = job.nextRuns(count, from);
    job.stop();
    return runs;
  } catch {
    return [];
  }
}

/**
 * The longest gap between consecutive runs of `schedule` (looking at its next
 * runs, so "weekdays at 3:00" counts the weekend gap; measured in UTC so a
 * daylight-saving change does not stretch it), or null when the schedule is
 * unusable.
 */
export function scheduleIntervalMs(schedule: string, from = new Date()): number | null {
  const runs = nextRuns(schedule, 10, from, true);
  if (runs.length < 2) return null;
  let max = 0;
  for (let i = 1; i < runs.length; i++) max = Math.max(max, runs[i]!.getTime() - runs[i - 1]!.getTime());
  return max;
}

/** The age after which a sync counts as overdue: the schedule interval, at least 6 h. */
export function catchUpThresholdMs(schedule: string, from = new Date()): number {
  return Math.max(MIN_CATCH_UP_INTERVAL_MS, scheduleIntervalMs(schedule, from) ?? 0);
}

/** True when the last completed sync is missing or at least one interval old. */
export function isSyncOverdue(lastSyncAt: number | null, schedule: string, now: number): boolean {
  if (lastSyncAt === null) return true;
  return now - lastSyncAt >= catchUpThresholdMs(schedule, new Date(now));
}

/**
 * The "Automatic sync looks stuck" notice: an enabled sync whose last
 * completed run is older than twice its interval. A sync that never ran yet
 * is not stuck (the catch-up handles it).
 */
export function isSyncStuck(opts: { enabled: boolean; schedule: string; lastSyncAt: number | null; now: number }): boolean {
  if (!opts.enabled || opts.lastSyncAt === null) return false;
  return opts.now - opts.lastSyncAt > 2 * catchUpThresholdMs(opts.schedule, new Date(opts.now));
}

export interface SyncTypeStatus {
  enabled: boolean;
  schedule: string;
  lastSyncAt: number | null;
  lastSyncStartedAt: number | null;
  nextRunAt: number | null;
  running: boolean;
  stuck: boolean;
}

function readSchedule(db: Db, type: SyncType): { enabled: boolean; schedule: string } {
  const cfg = SYNC_TYPE_CONFIG[type];
  return {
    enabled: readSetting(db, cfg.enabledKey) === '1',
    schedule: readSetting(db, cfg.scheduleKey)?.trim() || cfg.defaultSchedule,
  };
}

/** The body of GET /api/admin/sync-status. */
export function readSyncStatus(db: Db, now = Date.now()): Record<SyncType, SyncTypeStatus> {
  const out = {} as Record<SyncType, SyncTypeStatus>;
  for (const type of SYNC_TYPES) {
    const cfg = SYNC_TYPE_CONFIG[type];
    const { enabled, schedule } = readSchedule(db, type);
    const lastSyncAt = readEpoch(db, cfg.lastSyncKey);
    const next = enabled ? nextRuns(schedule, 1, new Date(now))[0] : undefined;
    out[type] = {
      enabled,
      schedule,
      lastSyncAt,
      lastSyncStartedAt: readEpoch(db, cfg.lastStartedKey),
      nextRunAt: next ? next.getTime() : null,
      running: readSetting(db, cfg.activeFlagKey) === '1',
      stuck: isSyncStuck({ enabled, schedule, lastSyncAt, now }),
    };
  }
  return out;
}

/**
 * Why `type` gets no catch-up sync right now, or null when it should get one:
 * its automatic sync must be on, its module enabled, its downloads not
 * paused, no sync-all already running, the videos' downloads folder usable,
 * and its last completed sync missing or overdue.
 */
export function catchUpSkipReason(db: Database.Database, type: SyncType, opts: { now: number; blockedReason?: string | null }): string | null {
  const cfg = SYNC_TYPE_CONFIG[type];
  const { enabled, schedule } = readSchedule(db, type);
  if (!enabled) return 'automatic sync is off';
  if (!isModuleEnabled(db, cfg.moduleId)) return 'the module is disabled';
  if (isEffectivelyPaused(db, cfg.pausedKey, cfg.moduleId)) return 'downloads are paused';
  if (readSetting(db, cfg.activeFlagKey) === '1') return 'a sync is already running';
  if (type === 'video' && opts.blockedReason) return 'the downloads folder is unavailable';
  if (!isSyncOverdue(readEpoch(db, cfg.lastSyncKey), schedule, opts.now)) return 'the last sync is recent';
  return null;
}

export interface StartupCatchUpDeps {
  getDb: () => Database.Database;
  runners: Record<SyncType, () => Promise<void>>;
  /** The videos' downloads-folder problem, if any (getDownloadsDirState().blockedReason). */
  blockedReason?: () => string | null;
  delayMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * Schedules the startup catch-up: after `delayMs`, every type whose last sync
 * is overdue (see catchUpSkipReason) gets one sync-all, one type after the
 * other in the background. Nothing starts during shutdown. Returns a function
 * that cancels the pending timer (shutdown).
 */
export function scheduleStartupCatchUp(deps: StartupCatchUpDeps): () => void {
  const log = deps.log ?? ((msg: string) => console.log(`[auto-sync] ${msg}`));
  const now = deps.now ?? Date.now;
  let cancelled = false;
  const timer = setTimeout(() => {
    void runStartupCatchUp().catch((err) => console.error('[auto-sync] Startup catch-up failed:', err));
  }, deps.delayMs ?? STARTUP_CATCH_UP_DELAY_MS);
  (timer as any).unref?.();

  async function runStartupCatchUp(): Promise<void> {
    for (const type of SYNC_TYPES) {
      if (cancelled || isShuttingDown()) return;
      const db = deps.getDb();
      if (!db.open) return;
      const reason = catchUpSkipReason(db, type, { now: now(), blockedReason: deps.blockedReason?.() ?? null });
      if (reason) continue;
      log(`The last ${SYNC_TYPE_CONFIG[type].label} sync is overdue: starting a catch-up sync.`);
      try {
        await deps.runners[type]();
      } catch (err) {
        console.error(`[auto-sync] The ${SYNC_TYPE_CONFIG[type].label} catch-up sync failed:`, err);
      }
    }
  }

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
