import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/modules.get';
import postHandler from '../../server/api/admin/settings/modules.post';
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

const value = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const post = (cookie: string | undefined, body: any) => postHandler(mockEvent(cookie, { path: '/api/admin/settings/modules', body }));

describe('GET /api/settings/modules', () => {
  it('returns every module enabled when no setting exists', async () => {
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/modules' }));
    expect(result).toEqual({ video: true, music: true, podcasts: true });
  });

  it('reflects each module independently', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/modules' }));
    expect(result).toEqual({ video: true, music: false, podcasts: false });
  });

  it('is readable by a guest (public)', async () => {
    await expect(getHandler(mockEvent(undefined, { path: '/api/settings/modules' }))).resolves.toBeDefined();
  });

  it('returns everything enabled when the database is unavailable (fail-open)', async () => {
    (globalThis as any).getDb = () => ({ prepare: () => { throw new Error('Database is locked or unavailable'); } });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/modules' }));
    expect(result).toEqual({ video: true, music: true, podcasts: true });
  });
});

describe('POST /api/admin/settings/modules', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(post(undefined, { music: false })).rejects.toMatchObject({ statusCode: 401 });
    await expect(post(loginAs('u1', 'user'), { music: false })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 for an empty body, an unknown key only, or a non-boolean value', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(post(cookie, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(post(cookie, { nope: true })).rejects.toMatchObject({ statusCode: 400 });
    await expect(post(cookie, { music: 'false' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(post(cookie, null)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('persists a single module and returns the new states', async () => {
    const cookie = loginAs('admin1', 'admin');
    const result: any = await post(cookie, { podcasts: false });
    expect(result).toEqual({ video: true, music: true, podcasts: false });
    expect(value('podcasts_module_enabled')).toBe('0');
    expect(value('video_module_enabled')).toBeUndefined();
  });

  it('updates several modules in one call', async () => {
    const cookie = loginAs('admin1', 'admin');
    const result: any = await post(cookie, { video: false, music: false });
    expect(result).toEqual({ video: false, music: false, podcasts: true });
  });

  it('re-enables a module', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = loginAs('admin1', 'admin');
    const result: any = await post(cookie, { music: true });
    expect(result.music).toBe(true);
    expect(value('music_module_enabled')).toBe('1');
  });

  it('refuses to disable the last enabled module with 400 and changes nothing', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    const cookie = loginAs('admin1', 'admin');
    await expect(post(cookie, { music: false })).rejects.toMatchObject({ statusCode: 400 });
    expect(value('music_module_enabled')).toBeUndefined();
  });

  it('refuses a single call that would disable everything', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(post(cookie, { video: false, music: false, podcasts: false })).rejects.toMatchObject({ statusCode: 400 });
    expect(value('video_module_enabled')).toBeUndefined();
  });
});
