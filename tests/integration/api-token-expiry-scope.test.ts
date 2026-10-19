import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getUserFromSession, startSessionCleanup, SESSION_PURGE_INTERVAL_MS } from '../../server/utils/auth';
import { createApiToken, listApiTokens, getUserFromApiToken, purgeExpiredApiTokens } from '../../server/utils/apiTokens';
import tokensPost from '../../server/api/account/tokens/index.post';
import tokensGet from '../../server/api/account/tokens/index.get';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

const DAY = 24 * 60 * 60 * 1000;
let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertUser(db, { id: 'u1', role: 'user' });
  insertUser(db, { id: 'a1', role: 'admin' });
  insertSession(db, { id: 's-u1', userId: 'u1' });
});

afterEach(() => {
  vi.useRealTimers();
});

const bearer = (token: string, method = 'GET') =>
  mockEvent(undefined, { method, headers: { authorization: `Bearer ${token}` } });

const createViaRoute = (body: unknown) =>
  tokensPost(mockEvent(sessionCookie('s-u1'), { method: 'POST', body }));

describe('token creation (POST /api/account/tokens)', () => {
  it('defaults to a read-only token that expires in 90 days', async () => {
    const before = Date.now();
    const res: any = await createViaRoute({ name: 'phone' });
    const row = db.prepare('SELECT scope, expires_at, label FROM api_tokens WHERE id = ?').get(res.id) as any;
    expect(row.scope).toBe('read');
    expect(row.label).toBe('phone');
    expect(row.expires_at).toBeGreaterThanOrEqual(before + 90 * DAY);
    expect(row.expires_at).toBeLessThanOrEqual(Date.now() + 90 * DAY);
    expect(res).toMatchObject({ scope: 'read', token: expect.stringMatching(/^yk_/) });
  });

  it('still accepts the legacy "label" field', async () => {
    const res: any = await createViaRoute({ label: 'script' });
    expect(res.label).toBe('script');
  });

  it('accepts full scope, a custom expiry, and an explicit null (never expires)', async () => {
    const a: any = await createViaRoute({ name: 'a', scope: 'full', expiresInDays: 30 });
    const b: any = await createViaRoute({ name: 'b', expiresInDays: null });
    const rowA = db.prepare('SELECT scope, expires_at FROM api_tokens WHERE id = ?').get(a.id) as any;
    const rowB = db.prepare('SELECT scope, expires_at FROM api_tokens WHERE id = ?').get(b.id) as any;
    expect(rowA.scope).toBe('full');
    expect(rowA.expires_at - Date.now()).toBeGreaterThan(29 * DAY);
    expect(rowA.expires_at - Date.now()).toBeLessThanOrEqual(30 * DAY);
    expect(rowB.expires_at).toBeNull();
  });

  it.each([
    [{ name: 'x', scope: 'admin' }],
    [{ name: 'x', expiresInDays: 0 }],
    [{ name: 'x', expiresInDays: 366 }],
    [{ name: 'x', expiresInDays: 1.5 }],
    [{ name: 'x', expiresInDays: '30' }],
  ])('rejects invalid input %j with 400', async (body) => {
    const err: any = await createViaRoute(body).catch((e: any) => e);
    expect(err?.statusCode).toBe(400);
    expect((db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get() as any).n).toBe(0);
  });
});

describe('expiry', () => {
  it('rejects an expired token', async () => {
    const { token, id } = createApiToken('u1', 'old', { scope: 'full', expiresAt: Date.now() + 1000 });
    expect(getUserFromApiToken(token)).toMatchObject({ id: 'u1' });
    db.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run(Date.now() - 1, id);
    expect(getUserFromApiToken(token)).toBeNull();
    expect(await getUserFromSession(bearer(token))).toBeNull();
  });

  it('a token without expiry keeps working', () => {
    const { token } = createApiToken('u1', 'forever', { scope: 'full', expiresAt: null });
    expect(getUserFromApiToken(token)).toMatchObject({ id: 'u1' });
  });

  it('purgeExpiredApiTokens removes only expired tokens', () => {
    createApiToken('u1', 'old', { expiresAt: Date.now() - 1 });
    createApiToken('u1', 'future', { expiresAt: Date.now() + DAY });
    createApiToken('u1', 'never', { expiresAt: null });
    expect(purgeExpiredApiTokens()).toBe(1);
    expect((db.prepare('SELECT label FROM api_tokens ORDER BY label').all() as any[]).map((r) => r.label)).toEqual(['future', 'never']);
  });

  it('the hourly session cleanup also purges expired tokens', () => {
    vi.useFakeTimers();
    const stop = startSessionCleanup();
    createApiToken('u1', 'old', { expiresAt: Date.now() - 1 });
    vi.advanceTimersByTime(SESSION_PURGE_INTERVAL_MS);
    stop();
    expect((db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get() as any).n).toBe(0);
  });
});

describe('read-only scope', () => {
  it.each(['GET', 'HEAD'])('allows %s', async (method) => {
    const { token } = createApiToken('a1', 'reader', { scope: 'read' });
    expect(await getUserFromSession(bearer(token, method))).toMatchObject({ id: 'a1', via: 'token' });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s with 403', async (method) => {
    const { token } = createApiToken('a1', 'reader', { scope: 'read' });
    const err: any = await getUserFromSession(bearer(token, method)).catch((e: any) => e);
    expect(err?.statusCode).toBe(403);
    expect(err?.statusMessage).toBe('This API token is read-only.');
  });

  it('a full token can still write', async () => {
    const { token } = createApiToken('a1', 'writer', { scope: 'full' });
    expect(await getUserFromSession(bearer(token, 'POST'))).toMatchObject({ id: 'a1' });
    expect(await getUserFromSession(bearer(token, 'DELETE'))).toMatchObject({ id: 'a1' });
  });
});

describe('listing', () => {
  it('returns scope, expiresAt and lastUsedAt, never the secret or hash', async () => {
    const created: any = await createViaRoute({ name: 'phone', scope: 'full', expiresInDays: 30 });
    getUserFromApiToken(created.token);
    const res: any = await tokensGet(mockEvent(sessionCookie('s-u1')));
    expect(res.tokens).toEqual([{
      id: created.id, label: 'phone', scope: 'full', createdAt: expect.any(Number),
      expiresAt: expect.any(Number), lastUsedAt: expect.any(Number),
    }]);
    const hash = (db.prepare('SELECT token_hash FROM api_tokens').get() as any).token_hash;
    expect(JSON.stringify(res)).not.toContain(hash);
    expect(JSON.stringify(res)).not.toContain(created.token);
    expect(listApiTokens('a1')).toEqual([]);
  });
});

describe('last_used_at throttle', () => {
  it('writes at most once per minute', () => {
    const { token, id } = createApiToken('u1', 't');
    getUserFromApiToken(token);
    const first = (db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(id) as any).last_used_at;
    expect(first).not.toBeNull();
    const spy = vi.spyOn(db, 'prepare');
    for (let i = 0; i < 5; i++) getUserFromApiToken(token);
    const updates = spy.mock.calls.filter(([sql]) => /UPDATE api_tokens/i.test(String(sql)));
    spy.mockRestore();
    expect(updates.length).toBe(0);
  });
});
