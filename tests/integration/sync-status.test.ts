import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/sync-status.get';
import { requireAdmin } from '../../server/utils/auth';
import { applyAutoSyncDefaults, recordSyncFinished } from '../../server/utils/autoSync';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T12:10:00Z'));
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
});
afterEach(() => vi.useRealTimers());

function loginAs(userId: string, role: 'admin' | 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId, expiresAt: Date.now() + 24 * HOUR });
  return sessionCookie(`sess-${userId}`);
}
const call = (cookie?: string) => handler(mockEvent(cookie, { path: '/api/admin/sync-status' }));

describe('GET /api/admin/sync-status', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
    await expect(call(loginAs('u1', 'user'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns each type with schedule, last sync, next run and the stuck flag', async () => {
    applyAutoSyncDefaults(db, () => {});
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'podcast_sync_cron_enabled'").run();
    recordSyncFinished(db, 'video', Date.now() - 3 * 24 * HOUR);
    recordSyncFinished(db, 'music', Date.now() - HOUR);
    const res: any = await call(loginAs('admin', 'admin'));
    expect(Object.keys(res).sort()).toEqual(['music', 'podcast', 'video']);
    expect(res.video).toMatchObject({ enabled: true, schedule: '0 */6 * * *', lastSyncAt: Date.now() - 3 * 24 * HOUR, lastSyncStartedAt: null, stuck: true });
    expect(res.video.nextRunAt).toBeGreaterThan(Date.now());
    expect(res.music).toMatchObject({ enabled: true, schedule: '30 */6 * * *', stuck: false });
    expect(res.podcast).toMatchObject({ enabled: false, nextRunAt: null, lastSyncAt: null, stuck: false });
  });
});
