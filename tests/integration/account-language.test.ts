import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/account/language.get';
import putHandler from '../../server/api/account/language.put';
import meHandler from '../../server/api/auth/me.get';
import { getUserFromSession } from '../../server/utils/auth';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let cookie: string;
beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
  insertUser(db, { id: 'u1', role: 'user' });
  insertSession(db, { id: 's1', userId: 'u1' });
  cookie = sessionCookie('s1');
});
const get = (c?: string) => getHandler(mockEvent(c, { path: '/api/account/language' }));
const put = (c: string | undefined, body: any) => putHandler(mockEvent(c, { path: '/api/account/language', body, method: 'PUT' }));

describe('account language', () => {
  it('is null until chosen, then stored', async () => {
    expect(await get(cookie)).toEqual({ uiLanguage: null });
    expect(await put(cookie, { uiLanguage: 'fr' })).toEqual({ uiLanguage: 'fr' });
    expect(await get(cookie)).toEqual({ uiLanguage: 'fr' });
  });
  it('null clears the choice', async () => {
    await put(cookie, { uiLanguage: 'de' });
    expect(await put(cookie, { uiLanguage: null })).toEqual({ uiLanguage: null });
  });
  it('rejects unknown codes and anonymous callers', async () => {
    await expect(put(cookie, { uiLanguage: 'xx' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(get(undefined)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('is exposed on /api/auth/me', async () => {
    await put(cookie, { uiLanguage: 'ja' });
    const me: any = await meHandler(mockEvent(cookie, { path: '/api/auth/me' }));
    expect(me.user.uiLanguage).toBe('ja');
  });
});
