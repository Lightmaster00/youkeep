import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cronScheduleProblem, MIN_CRON_INTERVAL_MS } from '../../server/utils/validation';
import musicPost from '../../server/api/admin/music/schedule.post';
import videoPost from '../../server/api/admin/downloader/schedule.post';
import podcastPost from '../../server/api/admin/podcasts/schedule.post';
import * as downloader from '../../server/utils/downloader';
import * as musicDownloader from '../../server/utils/musicDownloader';
import * as podcastDownloader from '../../server/utils/podcastDownloader';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';
import { requireAdmin } from '../../server/utils/auth';

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  downloader.stopScheduler();
  musicDownloader.stopMusicScheduler();
  podcastDownloader.stopPodcastScheduler();
  vi.restoreAllMocks();
});

describe('cronScheduleProblem (L1)', () => {
  it('accepts 5-field schedules at least 10 minutes apart, and nicknames', () => {
    expect(MIN_CRON_INTERVAL_MS).toBe(10 * 60 * 1000);
    for (const ok of ['0 3 * * *', '*/10 * * * *', '0 * * * *', '30 3 * * 1', '@daily', '@hourly']) expect(cronScheduleProblem(ok)).toBeNull();
  });

  it('refuses a seconds field (6 parts) and 7 parts', () => {
    expect(cronScheduleProblem('* * * * * *')).toMatch(/5 fields/);
    expect(cronScheduleProblem('0 0 3 * * * *')).toMatch(/5 fields/);
  });

  it('refuses schedules that run more often than every 10 minutes', () => {
    for (const bad of ['* * * * *', '*/5 * * * *', '0,5 3 * * *', '*/9 * * * *']) expect(cronScheduleProblem(bad)).toMatch(/10 minutes/);
  });

  it('refuses garbage', () => {
    expect(cronScheduleProblem('not a cron')).toMatch(/Invalid/);
  });
});

describe('the schedule routes use the rule', () => {
  it.each([['music', musicPost], ['video', videoPost], ['podcasts', podcastPost]])('%s: 400 for a seconds field or a 1-minute schedule', async (_n, handler: any) => {
    insertUser(db, { id: 'admin1', role: 'admin' });
    insertSession(db, { id: 'sess-admin1', userId: 'admin1' });
    const cookie = sessionCookie('sess-admin1');
    for (const schedule of ['* * * * * *', '* * * * *']) {
      await expect(handler(mockEvent(cookie, { method: 'POST', body: { enabled: true, schedule } }))).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});

describe('stored schedules at startup', () => {
  it.each([
    ['video', 'sync_cron_enabled', 'sync_cron_schedule', () => downloader.initScheduler(), () => downloader.getActiveCronJob()],
    ['music', 'music_sync_cron_enabled', 'music_sync_cron_schedule', () => musicDownloader.initMusicScheduler(), () => musicDownloader.getActiveMusicCronJob()],
    ['podcasts', 'podcast_sync_cron_enabled', 'podcast_sync_cron_schedule', () => podcastDownloader.initPodcastScheduler(), () => podcastDownloader.getActivePodcastCronJob()],
  ])('%s: a too-frequent stored schedule is disabled with a log line', (_n, enabledKey, scheduleKey, init: any, active: any) => {
    insertSetting(db, { key: enabledKey, value: '1' });
    insertSetting(db, { key: scheduleKey, value: '* * * * * *' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    init();
    expect(active()).toBeNull();
    expect((db.prepare('SELECT value FROM settings WHERE key = ?').get(enabledKey) as any).value).toBe('0');
    expect(warn.mock.calls.some((c) => /disabled/i.test(String(c[0])))).toBe(true);
  });

  it.each([
    ['video', 'sync_cron_enabled', 'sync_cron_schedule', () => downloader.initScheduler(), () => downloader.getActiveCronJob()],
    ['music', 'music_sync_cron_enabled', 'music_sync_cron_schedule', () => musicDownloader.initMusicScheduler(), () => musicDownloader.getActiveMusicCronJob()],
    ['podcasts', 'podcast_sync_cron_enabled', 'podcast_sync_cron_schedule', () => podcastDownloader.initPodcastScheduler(), () => podcastDownloader.getActivePodcastCronJob()],
  ])('%s: a valid schedule runs with overrun protection', (_n, enabledKey, scheduleKey, init: any, active: any) => {
    insertSetting(db, { key: enabledKey, value: '1' });
    insertSetting(db, { key: scheduleKey, value: '0 3 * * *' });
    init();
    expect(active()).not.toBeNull();
    expect(active().options.protect).toBe(true);
  });
});
