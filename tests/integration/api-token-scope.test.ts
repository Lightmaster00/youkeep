import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getUserFromSession, requireAdmin, hashPassword } from '../../server/utils/auth';
import { createApiToken } from '../../server/utils/apiTokens';
import tokensPost from '../../server/api/account/tokens/index.post';
import tokensGet from '../../server/api/account/tokens/index.get';
import passwordPut from '../../server/api/account/password.put';
import profilePut from '../../server/api/account/profile.put';
import usersPost from '../../server/api/admin/users/index.post';
import usersPut from '../../server/api/admin/users/[id].put';
import usersDelete from '../../server/api/admin/users/[id].delete';
import usersReset from '../../server/api/admin/users/[id]/reset-password.post';
import platformsPost from '../../server/api/admin/system/search-platforms.post';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let adminToken: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).hashPassword = hashPassword;
  db.exec(`CREATE TABLE search_platforms (id TEXT PRIMARY KEY, api_key TEXT NOT NULL DEFAULT '', api_secret TEXT NOT NULL DEFAULT '', updated_at INTEGER)`);
  insertUser(db, { id: 'a1', role: 'admin' });
  insertUser(db, { id: 'u1', role: 'user' });
  adminToken = createApiToken('a1', 'script').token;
});

const bearer = (token: string, opts: { method?: string; body?: unknown; params?: Record<string, string> } = {}) =>
  mockEvent(undefined, { method: opts.method ?? 'POST', headers: { authorization: `Bearer ${token}` }, params: opts.params, ...(opts.body !== undefined ? { body: opts.body } : {}) });

describe('UserSession.via', () => {
  it('is "token" for a Bearer token and "session" for a cookie', async () => {
    insertSession(db, { id: 's-a1', userId: 'a1' });
    expect((await getUserFromSession(bearer(adminToken)))?.via).toBe('token');
    expect((await getUserFromSession(mockEvent(sessionCookie('s-a1'))))?.via).toBe('session');
  });

  it('a stale session cookie does not hide a valid Bearer token', async () => {
    const event = mockEvent(sessionCookie('gone-session'), { headers: { authorization: `Bearer ${adminToken}` } });
    expect(await getUserFromSession(event)).toMatchObject({ id: 'a1', via: 'token' });
  });

  it('an expired session cookie does not hide a valid Bearer token', async () => {
    insertSession(db, { id: 's-old', userId: 'u1', expiresAt: Date.now() - 1000 });
    const event = mockEvent(sessionCookie('s-old'), { headers: { authorization: `Bearer ${adminToken}` } });
    expect(await getUserFromSession(event)).toMatchObject({ id: 'a1', via: 'token' });
  });
});

describe('credential and identity routes refuse API tokens (403)', () => {
  const cases: Array<[string, (e: any) => any, { method?: string; body?: unknown; params?: Record<string, string> }]> = [
    ['POST /api/account/tokens', tokensPost, { body: { label: 'another' } }],
    ['PUT /api/account/password', passwordPut, { method: 'PUT', body: { currentPassword: 'x-password', password: 'new-password-1' } }],
    ['PUT /api/account/profile', profilePut, { method: 'PUT', body: { firstName: 'Mallory' } }],
    ['POST /api/admin/users', usersPost, { body: { username: 'mallory', role: 'admin' } }],
    ['PUT /api/admin/users/:id', usersPut, { method: 'PUT', params: { id: 'u1' }, body: { role: 'admin' } }],
    ['DELETE /api/admin/users/:id', usersDelete, { method: 'DELETE', params: { id: 'u1' } }],
    ['POST /api/admin/users/:id/reset-password', usersReset, { params: { id: 'u1' } }],
    ['POST /api/admin/system/search-platforms', platformsPost, { body: { id: 'listennotes', apiKey: 'k' } }],
  ];

  it.each(cases)('%s', async (_name, handler, opts) => {
    const err: any = await Promise.resolve().then(() => handler(bearer(adminToken, opts))).catch((e) => e);
    expect(err?.statusCode).toBe(403);
    expect(err?.statusMessage).toBe('Not available with an API token.');
    // Nothing was created or changed.
    expect((db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get() as any).n).toBe(1);
    expect((db.prepare("SELECT role FROM users WHERE id = 'u1'").get() as any).role).toBe('user');
  });

  it('reading routes still work with a token', async () => {
    await expect(tokensGet(bearer(adminToken, { method: 'GET' }))).resolves.toMatchObject({ tokens: expect.any(Array) });
  });
});
