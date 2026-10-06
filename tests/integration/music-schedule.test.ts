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
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(getHandler(mockEvent(undefined, { path: '/api/admin/music/schedule' }))).rejects.toMatchObject({ statusCode: 401 });
    const cookie = loginAs('u1', 'user');
    await expect(getHandler(mockEvent(cookie, { path: '/api/admin/music/schedule' }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('defaults to disabled with the default schedule, then reflects persisted settings', async () => {
    const cookie = loginAs('admin1', 'admin');
    expect(await getHandler(mockEvent(cookie, { path: '/api/admin/music/schedule' }))).toEqual({ enabled: false, schedule: '30 3 * * *' });
    insertSetting(db, { key: 'music_sync_cron_enabled', value: '1' });
    insertSetting(db, { key: 'music_sync_cron_schedule', value: '0 * * * *' });
    expect(await getHandler(mockEvent(cookie, { path: '/api/admin/music/schedule' }))).toEqual({ enabled: true, schedule: '0 * * * *' });
  });
});

describe('POST /api/admin/music/schedule', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(postHandler(mockEvent(undefined, { path: '/api/admin/music/schedule', body: { enabled: true, schedule: '0 3 * * *' } }))).rejects.toMatchObject({ statusCode: 401 });
    const cookie = loginAs('u1', 'user');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/music/schedule', body: { enabled: true, schedule: '0 3 * * *' } }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 when enabled with a missing or invalid cron expression', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/music/schedule', body: { enabled: true, schedule: '' } }))).rejects.toMatchObject({ statusCode: 400 });
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
