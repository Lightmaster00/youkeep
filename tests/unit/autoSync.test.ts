import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, insertSetting } from '../helpers/testDb';
import {
  applyAutoSyncDefaults, catchUpSkipReason, isSyncStuck, isSyncOverdue, readSyncStatus,
  recordSyncFinished, recordSyncStarted, scheduleIntervalMs, scheduleStartupCatchUp,
  SYNC_TYPE_CONFIG, AUTO_SYNC_MIGRATION_KEY,
} from '../../server/utils/autoSync';
import { markShuttingDown } from '../../server/utils/processTree';

const HOUR = 60 * 60 * 1000;
let db: Database.Database;
const get = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const quiet = () => {};

// What older versions seeded on every install.
function seedLegacy() {
  insertSetting(db, { key: 'sync_cron_enabled', value: '0' });
  insertSetting(db, { key: 'sync_cron_schedule', value: '0 3 * * *' });
  insertSetting(db, { key: 'music_sync_cron_enabled', value: '0' });
  insertSetting(db, { key: 'music_sync_cron_schedule', value: '30 3 * * *' });
  insertSetting(db, { key: 'podcast_sync_cron_enabled', value: '0' });
  insertSetting(db, { key: 'podcast_sync_cron_schedule', value: '0 4 * * *' });
  for (const k of ['sync_all_active', 'music_sync_all_active', 'podcast_sync_all_active', 'downloader_paused', 'music_downloader_paused', 'podcast_downloader_paused']) {
    insertSetting(db, { key: k, value: '0' });
  }
}

beforeEach(() => {
  db = createTestDb();
});

describe('applyAutoSyncDefaults (auto_sync_default_v1)', () => {
  it('turns the three schedules on with the new defaults, replacing the old seeded schedules', () => {
    seedLegacy();
    applyAutoSyncDefaults(db, quiet);
    expect(get('sync_cron_enabled')).toBe('1');
    expect(get('sync_cron_schedule')).toBe('0 */6 * * *');
    expect(get('music_sync_cron_enabled')).toBe('1');
    expect(get('music_sync_cron_schedule')).toBe('30 */6 * * *');
    expect(get('podcast_sync_cron_enabled')).toBe('1');
    expect(get('podcast_sync_cron_schedule')).toBe('45 */6 * * *');
    expect(get(AUTO_SYNC_MIGRATION_KEY)).toBe('1');
  });

  it('works on a database with no schedule rows at all', () => {
    applyAutoSyncDefaults(db, quiet);
    expect(get('sync_cron_enabled')).toBe('1');
    expect(get('podcast_sync_cron_schedule')).toBe('45 */6 * * *');
  });

  it('keeps a custom schedule and only turns it on', () => {
    seedLegacy();
    db.prepare("UPDATE settings SET value = '15 */2 * * *' WHERE key = 'music_sync_cron_schedule'").run();
    applyAutoSyncDefaults(db, quiet);
    expect(get('music_sync_cron_schedule')).toBe('15 */2 * * *');
    expect(get('music_sync_cron_enabled')).toBe('1');
  });

  it('runs once: a schedule disabled afterwards stays disabled', () => {
    seedLegacy();
    applyAutoSyncDefaults(db, quiet);
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'sync_cron_enabled'").run();
    db.prepare("UPDATE settings SET value = '0 3 * * *' WHERE key = 'sync_cron_schedule'").run();
    applyAutoSyncDefaults(db, quiet);
    expect(get('sync_cron_enabled')).toBe('0');
    expect(get('sync_cron_schedule')).toBe('0 3 * * *');
  });

  it('does nothing when the flag is already set', () => {
    seedLegacy();
    insertSetting(db, { key: AUTO_SYNC_MIGRATION_KEY, value: '1' });
    applyAutoSyncDefaults(db, quiet);
    expect(get('sync_cron_enabled')).toBe('0');
    expect(get('sync_cron_schedule')).toBe('0 3 * * *');
  });
});

describe('interval, overdue and stuck', () => {
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);

  it('measures the schedule interval, and refuses an unusable schedule', () => {
    expect(scheduleIntervalMs('0 */6 * * *', new Date(now))).toBe(6 * HOUR);
    expect(scheduleIntervalMs('0 3 * * *', new Date(now))).toBe(24 * HOUR);
    expect(scheduleIntervalMs('not a cron')).toBeNull();
  });

  it('is overdue when never synced, or older than the interval (at least 6 h)', () => {
    expect(isSyncOverdue(null, '0 */6 * * *', now)).toBe(true);
    expect(isSyncOverdue(now - 7 * HOUR, '0 */6 * * *', now)).toBe(true);
    expect(isSyncOverdue(now - 5 * HOUR, '0 */6 * * *', now)).toBe(false);
    // A 10-minute schedule still waits 6 h before a catch-up.
    expect(isSyncOverdue(now - 1 * HOUR, '*/10 * * * *', now)).toBe(false);
    // A daily schedule is overdue only after a day.
    expect(isSyncOverdue(now - 20 * HOUR, '0 3 * * *', now)).toBe(false);
    expect(isSyncOverdue(now - 25 * HOUR, '0 3 * * *', now)).toBe(true);
  });

  it('is stuck only when enabled and older than twice the interval', () => {
    const base = { enabled: true, schedule: '0 */6 * * *', now };
    expect(isSyncStuck({ ...base, lastSyncAt: now - 13 * HOUR })).toBe(true);
    expect(isSyncStuck({ ...base, lastSyncAt: now - 11 * HOUR })).toBe(false);
    expect(isSyncStuck({ ...base, enabled: false, lastSyncAt: now - 72 * HOUR })).toBe(false);
    expect(isSyncStuck({ ...base, lastSyncAt: null })).toBe(false);
  });
});

describe('readSyncStatus', () => {
  it('reports each type with its last sync, next run and stuck state', () => {
    seedLegacy();
    applyAutoSyncDefaults(db, quiet);
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'podcast_sync_cron_enabled'").run();
    const now = Date.UTC(2026, 9, 23, 12, 10, 0);
    recordSyncStarted(db, 'video', now - 3 * 24 * HOUR - 1000);
    recordSyncFinished(db, 'video', now - 3 * 24 * HOUR);
    recordSyncFinished(db, 'music', now - HOUR);
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'music_sync_all_active'").run();

    const s = readSyncStatus(db, now);
    expect(s.video).toEqual({
      enabled: true, schedule: '0 */6 * * *',
      lastSyncAt: now - 3 * 24 * HOUR, lastSyncStartedAt: now - 3 * 24 * HOUR - 1000,
      nextRunAt: expect.any(Number),
      running: false, stuck: true,
    });
    // The next "0 */6" run (local time): within 6 h, on the hour, a multiple of 6.
    const next = new Date(s.video.nextRunAt!);
    expect(s.video.nextRunAt! - now).toBeGreaterThan(0);
    expect(s.video.nextRunAt! - now).toBeLessThanOrEqual(6 * HOUR);
    expect(next.getMinutes()).toBe(0);
    expect(next.getHours() % 6).toBe(0);
    expect(s.music.stuck).toBe(false);
    expect(s.music.running).toBe(true);
    expect(s.music.lastSyncStartedAt).toBeNull();
    expect(s.podcast).toMatchObject({ enabled: false, nextRunAt: null, lastSyncAt: null, stuck: false });
  });
});

describe('startup catch-up', () => {
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  let runners: Record<'video' | 'music' | 'podcast', ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.useFakeTimers();
    seedLegacy();
    applyAutoSyncDefaults(db, quiet);
    runners = { video: vi.fn(async () => {}), music: vi.fn(async () => {}), podcast: vi.fn(async () => {}) };
  });
  afterEach(() => {
    vi.useRealTimers();
    markShuttingDown(false);
  });

  const start = (extra: Partial<Parameters<typeof scheduleStartupCatchUp>[0]> = {}) =>
    scheduleStartupCatchUp({ getDb: () => db, runners: runners as any, now: () => now, log: quiet, ...extra });

  it('starts nothing before 60 s, then syncs each never-synced type once', async () => {
    start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(runners.video).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runners.video).toHaveBeenCalledTimes(1);
    expect(runners.music).toHaveBeenCalledTimes(1);
    expect(runners.podcast).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(runners.video).toHaveBeenCalledTimes(1);
  });

  it('skips a type synced recently and catches up a stale one', async () => {
    recordSyncFinished(db, 'video', now - HOUR);
    recordSyncFinished(db, 'music', now - 7 * HOUR);
    recordSyncFinished(db, 'podcast', now - 2 * HOUR);
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runners.video).not.toHaveBeenCalled();
    expect(runners.music).toHaveBeenCalledTimes(1);
    expect(runners.podcast).not.toHaveBeenCalled();
  });

  it('respects disabled schedules, disabled modules, pauses, running syncs and a blocked folder', async () => {
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'sync_cron_enabled'").run();
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'podcast_downloader_paused'").run();
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runners.video).not.toHaveBeenCalled();
    expect(runners.music).not.toHaveBeenCalled();
    expect(runners.podcast).not.toHaveBeenCalled();

    db.prepare("UPDATE settings SET value = '1' WHERE key = 'sync_cron_enabled'").run();
    expect(catchUpSkipReason(db, 'video', { now, blockedReason: 'missing folder' })).toBe('the downloads folder is unavailable');
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'sync_all_active'").run();
    expect(catchUpSkipReason(db, 'video', { now })).toBe('a sync is already running');
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'sync_all_active'").run();
    expect(catchUpSkipReason(db, 'video', { now })).toBeNull();
  });

  it('never starts during shutdown, nor after being cancelled', async () => {
    markShuttingDown(true);
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runners.video).not.toHaveBeenCalled();
    markShuttingDown(false);

    const cancel = start();
    cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runners.video).not.toHaveBeenCalled();
  });

  it('keeps going when one sync throws', async () => {
    runners.video.mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runners.music).toHaveBeenCalledTimes(1);
  });
});

describe('config', () => {
  it('names one key set per type', () => {
    expect(SYNC_TYPE_CONFIG.video.lastSyncKey).toBe('video_last_sync_at');
    expect(SYNC_TYPE_CONFIG.music.lastStartedKey).toBe('music_last_sync_started_at');
    expect(SYNC_TYPE_CONFIG.podcast.lastSyncKey).toBe('podcast_last_sync_at');
  });
});
