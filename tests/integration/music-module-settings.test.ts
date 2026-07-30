import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/music-module.get';
import postHandler from '../../server/api/admin/settings/music-module.post';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(db: Database, userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('GET /api/settings/music-module', () => {
  it('returns enabled: true when the setting is missing entirely', async () => {
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(true);
  });

  it('returns enabled: true when the setting value is "1"', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(true);
  });

  it('returns enabled: false when the setting value is "0"', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(false);
  });

  it('returns enabled: true when database is unavailable (fail-open behavior)', async () => {
    (globalThis as any).getDb = () => {
      return {
        prepare: () => {
          throw new Error('Database is locked or unavailable');
        }
      };
    };
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(true);
  });
});

describe('POST /api/admin/settings/music-module', () => {
  it('returns 401 for a guest', async () => {
    await expect(postHandler(mockEvent(undefined, { path: '/api/admin/settings/music-module', body: { enabled: false } }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs(db, 'u1', 'user');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: false } }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 when enabled is missing or not a boolean', async () => {
    const cookie = loginAs(db, 'admin1', 'admin');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: {} }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: 'false' } }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('persists enabled: false for an admin', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const cookie = loginAs(db, 'admin1', 'admin');
    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: false } }));
    expect(result.enabled).toBe(false);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string };
    expect(row.value).toBe('0');
  });

  it('persists enabled: true for an admin, re-enabling', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = loginAs(db, 'admin1', 'admin');
    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: true } }));
    expect(result.enabled).toBe(true);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string };
    expect(row.value).toBe('1');
  });

  it('creates the music_module_enabled row when it does not exist yet', async () => {
    const cookie = loginAs(db, 'admin1', 'admin');
    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: false } }));
    expect(result.enabled).toBe(false);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.value).toBe('0');
  });
});
