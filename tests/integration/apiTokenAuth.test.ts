import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getUserFromSession, requireAdmin, canAccessMusicTrack } from '../../server/utils/auth';
import { createApiToken } from '../../server/utils/apiTokens';
import csrfMiddleware from '../../server/middleware/csrf';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function bearerEvent(token: string, opts?: { method?: string }) {
  return mockEvent(undefined, { method: opts?.method ?? 'GET', headers: { authorization: `Bearer ${token}` } });
}

describe('getUserFromSession with a Bearer token', () => {
  it('authenticates via a valid Bearer token when there is no session cookie', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    const result = await getUserFromSession(bearerEvent(created.token));
    expect(result).toEqual({ id: 'u1', username: 'user_u1', role: 'user', mustChangePassword: false });
  });

  it('returns null for an invalid token', async () => {
    const result = await getUserFromSession(bearerEvent('yk_not-a-real-token'));
    expect(result).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');
    db.prepare('DELETE FROM api_tokens WHERE id = ?').run(created.id);

    const result = await getUserFromSession(bearerEvent(created.token));
    expect(result).toBeNull();
  });

  it('returns null for a malformed Authorization header (not "Bearer <token>" shaped), same as no header at all', async () => {
    const event = mockEvent(undefined, { headers: { authorization: 'not-a-bearer-header' } });
    const result = await getUserFromSession(event);
    expect(result).toBeNull();
  });

  it('prefers the session cookie over a Bearer token when both are present', async () => {
    insertUser(db, { id: 'cookie-user', role: 'user' });
    insertSession(db, { id: 'sess1', userId: 'cookie-user' });
    insertUser(db, { id: 'token-user', role: 'user' });
    const created = createApiToken('token-user', 'My Phone');

    const event = mockEvent(sessionCookie('sess1'), { headers: { authorization: `Bearer ${created.token}` } });
    const result = await getUserFromSession(event);
    expect(result?.id).toBe('cookie-user');
  });

  it('carries the admin role through to requireAdmin', async () => {
    insertUser(db, { id: 'admin1', role: 'admin' });
    const created = createApiToken('admin1', 'Admin Token');

    const result = await requireAdmin(bearerEvent(created.token));
    expect(result.role).toBe('admin');
  });

  it('rejects a non-admin token from requireAdmin', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'User Token');

    await expect(requireAdmin(bearerEvent(created.token))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('carries private-content visibility through to canAccessMusicTrack, matching the owning user\'s access', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const hasAccess = await canAccessMusicTrack('t1', bearerEvent(created.token));
    expect(hasAccess).toBe(true);
  });

  it('a Bearer-authenticated mutating request is never blocked by the CSRF middleware, since it carries no session cookie', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    const event = bearerEvent(created.token, { method: 'POST' });

    expect(() => csrfMiddleware(event)).not.toThrow();
    const result = await getUserFromSession(event);
    expect(result?.id).toBe('u1');
  });

  it('accepts a case-insensitive "bearer" scheme (RFC 7235)', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');
    const event = mockEvent(undefined, { headers: { authorization: `bearer ${created.token}` } });
    const result = await getUserFromSession(event);
    expect(result?.id).toBe('u1');
  });
});
