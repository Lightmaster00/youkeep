import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/music-clips.get';
import postHandler from '../../server/api/admin/settings/music-clips.post';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('GET /api/settings/music-clips', () => {
  it('defaults to false when the row is missing and reflects the stored value', async () => {
    const get = async () => ((await getHandler(mockEvent(undefined, { path: '/api/settings/music-clips' }))) as any).enabled;
    expect(await get()).toBe(false);
    insertSetting(db, { key: 'music_download_clips', value: '1' });
    expect(await get()).toBe(true);
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'music_download_clips'").run();
    expect(await get()).toBe(false);
  });

  it('fails open to false (not true) when the DB read throws', async () => {
    (globalThis as any).getDb = () => {
      return {
        prepare: () => {
          throw new Error('Database is locked or unavailable');
        }
      };
    };
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-clips' }));
    expect(result.enabled).toBe(false);
  });
});

describe('POST /api/admin/settings/music-clips', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(postHandler(mockEvent(undefined, { path: '/api/admin/settings/music-clips', body: { enabled: true } }))).rejects.toMatchObject({ statusCode: 401 });
    const cookie = loginAs('u1', 'user');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: { enabled: true } }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 when enabled is missing or not a boolean', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: {} }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: { enabled: 'yes' } }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('persists the value for an admin, creating then overwriting the row', async () => {
    const cookie = loginAs('admin1', 'admin');
    const stored = () => (db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string }).value;
    expect(((await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: { enabled: true } }))) as any).enabled).toBe(true);
    expect(stored()).toBe('1');
    expect(((await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: { enabled: false } }))) as any).enabled).toBe(false);
    expect(stored()).toBe('0');
  });
});
