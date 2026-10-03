import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/display.get';
import putHandler from '../../server/api/account/preferences.put';
import adminPostHandler from '../../server/api/admin/settings/display-defaults.post';
import { createApiToken } from '../../server/utils/apiTokens';
import { APP_DEFAULTS } from '../../shared/displayPrefs';
import { createTestDb, insertUser, insertSession, insertSetting, insertUserPreferences, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

// Call at most once per userId in a test (a second call would violate users' PRIMARY KEY).
function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}

const get = (cookie?: string, headers?: Record<string, string>) => getHandler(mockEvent(cookie, { path: '/api/settings/display', headers }));
const put = (cookie: string | undefined, body: any) => putHandler(mockEvent(cookie, { path: '/api/account/preferences', body, method: 'PUT' }));
const adminPost = (cookie: string | undefined, body: any) => adminPostHandler(mockEvent(cookie, { path: '/api/admin/settings/display-defaults', body, method: 'POST' }));
const storedRow = (userId: string) => db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(userId) as { data: string } | undefined;
const storedDefaults = () => (db.prepare("SELECT value FROM settings WHERE key = 'display_defaults'").get() as { value: string } | undefined)?.value;

describe('GET /api/settings/display', () => {
  it('returns the app defaults and null overrides to a guest', async () => {
    const view: any = await get();
    expect(view).toEqual({ effective: APP_DEFAULTS, defaults: APP_DEFAULTS, overrides: null, adminDefaults: {} });
  });

  it('gives a logged-in user with no choices an empty overrides object', async () => {
    const cookie = loginAs('u1');
    const view: any = await get(cookie);
    expect(view.overrides).toEqual({});
    expect(view.effective).toEqual(APP_DEFAULTS);
  });

  it('merges the user overrides over the admin defaults', async () => {
    const cookie = loginAs('u1');
    insertSetting(db, { key: 'display_defaults', value: '{"density":"spacious","landingSpace":"music"}' });
    insertUserPreferences(db, { userId: 'u1', data: '{"landingSpace":"podcasts"}' });
    const view: any = await get(cookie);
    expect(view.effective).toEqual({ ...APP_DEFAULTS, density: 'spacious', landingSpace: 'podcasts' });
    expect(view.defaults.landingSpace).toBe('music');
    expect(view.adminDefaults).toEqual({ density: 'spacious', landingSpace: 'music' });
  });

  it('shows a guest the admin defaults', async () => {
    insertSetting(db, { key: 'display_defaults', value: '{"density":"compact"}' });
    const view: any = await get();
    expect(view.effective.density).toBe('compact');
    expect(view.overrides).toBeNull();
  });

  it('resolves a Bearer API token (no cookie) to that user', async () => {
    insertUser(db, { id: 'tok', role: 'user' });
    insertUserPreferences(db, { userId: 'tok', data: '{"density":"compact"}' });
    const { token } = createApiToken('tok', 'phone');
    const view: any = await get(undefined, { authorization: `Bearer ${token}` });
    expect(view.overrides).toEqual({ density: 'compact' });
    expect(view.effective.density).toBe('compact');
  });

  it('treats a corrupt stored row as no overrides', async () => {
    const cookie = loginAs('u1');
    insertUserPreferences(db, { userId: 'u1', data: '{{broken' });
    const view: any = await get(cookie);
    expect(view.overrides).toEqual({});
    expect(view.effective).toEqual(APP_DEFAULTS);
  });

  it('never fails: falls back to the app defaults when the database is unavailable', async () => {
    (globalThis as any).getDb = () => { throw new Error('db down'); };
    const view: any = await get();
    expect(view.effective).toEqual(APP_DEFAULTS);
    expect(view.overrides).toBeNull();
  });
});

describe('PUT /api/account/preferences', () => {
  it('rejects a guest with 401', async () => {
    await expect(put(undefined, { density: 'compact' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('stores only the changed keys and returns the new view', async () => {
    const cookie = loginAs('u1');
    const view: any = await put(cookie, { density: 'compact' });
    expect(JSON.parse(storedRow('u1')!.data)).toEqual({ density: 'compact' });
    expect(view.overrides).toEqual({ density: 'compact' });
    expect(view.effective.density).toBe('compact');
  });

  it('accepts several keys at once', async () => {
    const cookie = loginAs('u1');
    await put(cookie, { hiddenNavLinks: ['/shorts'], landingSpace: 'music' });
    expect(JSON.parse(storedRow('u1')!.data)).toEqual({ hiddenNavLinks: ['/shorts'], landingSpace: 'music' });
  });

  it('removes a key with null, and deletes the row when nothing is left', async () => {
    const cookie = loginAs('u1');
    await put(cookie, { density: 'compact', landingSpace: 'music' });
    await put(cookie, { density: null });
    expect(JSON.parse(storedRow('u1')!.data)).toEqual({ landingSpace: 'music' });
    await put(cookie, { landingSpace: null });
    expect(storedRow('u1')).toBeUndefined();
  });

  it('writes nothing and returns 400 for an invalid value', async () => {
    const cookie = loginAs('u1');
    await expect(put(cookie, { density: 'huge' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, { hiddenNavLinks: ['/'] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, { hiddenNavLinks: ['/shorts', '/shorts'] })).rejects.toMatchObject({ statusCode: 400 });
    expect(storedRow('u1')).toBeUndefined();
  });

  it('does not partially apply a body that mixes a valid and an invalid key', async () => {
    const cookie = loginAs('u1');
    await expect(put(cookie, { landingSpace: 'music', density: 'huge' })).rejects.toMatchObject({ statusCode: 400 });
    expect(storedRow('u1')).toBeUndefined();
  });

  it('returns 400 for an empty body or a body with no recognised key', async () => {
    const cookie = loginAs('u1');
    await expect(put(cookie, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, { theme: 'light' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, null)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('works for a Bearer API token', async () => {
    insertUser(db, { id: 'tok', role: 'user' });
    const { token } = createApiToken('tok', 'phone');
    const event = mockEvent(undefined, { path: '/api/account/preferences', body: { density: 'spacious' }, headers: { authorization: `Bearer ${token}` } });
    await putHandler(event);
    expect(JSON.parse(storedRow('tok')!.data)).toEqual({ density: 'spacious' });
  });

  it("never touches another user's preferences", async () => {
    const cookie = loginAs('u1');
    insertUser(db, { id: 'u2', role: 'user' });
    insertUserPreferences(db, { userId: 'u2', data: '{"density":"compact"}' });
    await put(cookie, { density: 'spacious' });
    expect(JSON.parse(storedRow('u2')!.data)).toEqual({ density: 'compact' });
  });
});

describe('POST /api/admin/settings/display-defaults', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(adminPost(undefined, { density: 'compact' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(adminPost(loginAs('u1', 'user'), { density: 'compact' })).rejects.toMatchObject({ statusCode: 403 });
    expect(storedDefaults()).toBeUndefined();
  });

  it('stores the defaults and returns the admin view', async () => {
    const cookie = loginAs('admin1', 'admin');
    const view: any = await adminPost(cookie, { density: 'spacious', landingSpace: 'music' });
    expect(JSON.parse(storedDefaults()!)).toEqual({ density: 'spacious', landingSpace: 'music' });
    expect(view.adminDefaults).toEqual({ density: 'spacious', landingSpace: 'music' });
  });

  it('applies to a user without overrides and to a guest, but not over a personal choice', async () => {
    const cookie = loginAs('admin1', 'admin');
    await adminPost(cookie, { density: 'compact' });
    insertUser(db, { id: 'plain', role: 'user' });
    insertUser(db, { id: 'picky', role: 'user' });
    insertUserPreferences(db, { userId: 'picky', data: '{"density":"spacious"}' });
    insertSession(db, { id: 'sess-plain', userId: 'plain' });
    insertSession(db, { id: 'sess-picky', userId: 'picky' });
    expect(((await get(sessionCookie('sess-plain'))) as any).effective.density).toBe('compact');
    expect(((await get(sessionCookie('sess-picky'))) as any).effective.density).toBe('spacious');
    expect(((await get()) as any).effective.density).toBe('compact');
  });

  it('removes a default with null and deletes the setting when nothing is left', async () => {
    const cookie = loginAs('admin1', 'admin');
    await adminPost(cookie, { density: 'compact' });
    await adminPost(cookie, { density: null });
    expect(storedDefaults()).toBeUndefined();
  });

  it('returns 400 and writes nothing for an invalid value or an empty body', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(adminPost(cookie, { density: 'huge' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(adminPost(cookie, {})).rejects.toMatchObject({ statusCode: 400 });
    expect(storedDefaults()).toBeUndefined();
  });
});
