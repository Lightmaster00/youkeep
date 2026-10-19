import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  recordSecurityEvent, purgeSecurityEvents, listSecurityEvents, isKnownLoginIp,
  SECURITY_EVENT_RETENTION_MS, SECURITY_EVENT_MAX_ROWS,
} from '../../server/utils/securityLog';
import { runAuthMaintenance, requireAdmin, hashPassword } from '../../server/utils/auth';
import { createApiToken } from '../../server/utils/apiTokens';
import { resetAllRateLimits } from '../../server/utils/rateLimit';
import securityEventsGet from '../../server/api/admin/security-events.get';
import loginPost from '../../server/api/auth/login.post';
import passwordPut from '../../server/api/account/password.put';
import tokensPost from '../../server/api/account/tokens/index.post';
import tokenDelete from '../../server/api/account/tokens/[id].delete';
import usersPost from '../../server/api/admin/users/index.post';
import usersPut from '../../server/api/admin/users/[id].put';
import usersDelete from '../../server/api/admin/users/[id].delete';
import usersReset from '../../server/api/admin/users/[id]/reset-password.post';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

const rows = () => db.prepare('SELECT * FROM security_events ORDER BY id').all() as any[];
const ofType = (type: string) => rows().filter((r) => r.type === type);

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).hashPassword = hashPassword;
  resetAllRateLimits();
  delete process.env.TRUST_PROXY;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  insertUser(db, { id: 'a1', role: 'admin' });
  insertUser(db, { id: 'u1', role: 'user' });
  insertSession(db, { id: 's-a1', userId: 'a1' });
  insertSession(db, { id: 's-u1', userId: 'u1' });
});

const withIp = (e: any, ip = '192.0.2.10') => {
  e.node.req.socket = { remoteAddress: ip };
  return e;
};

describe('recordSecurityEvent', () => {
  it('stores type, time, ip, user and details', () => {
    const event = withIp(mockEvent());
    recordSecurityEvent(event, 'token_created', { userId: 'u1', username: 'bob', tokenId: 't1', scope: 'read' });
    const [row] = rows();
    expect(row).toMatchObject({ type: 'token_created', ip: '192.0.2.10', user_id: 'u1', username: 'bob' });
    expect(row.created_at).toBeGreaterThan(Date.now() - 5000);
    expect(JSON.parse(row.details)).toEqual({ tokenId: 't1', scope: 'read' });
  });

  it('never stores passwords, secrets, hashes or raw tokens', () => {
    recordSecurityEvent(null, 'login_failed', {
      username: 'bob', reason: 'bad_credentials',
      password: 'hunter2-secret', newPassword: 'x-new-pass', token: 'yk_rawtokenvalue', tokenHash: 'abc123hash',
      apiKey: 'k-123', secret: 's-123', authorization: 'Bearer yk_zzz', cookie: 'youkeep_session=1',
    } as any);
    const text = JSON.stringify(rows());
    for (const leaked of ['hunter2-secret', 'x-new-pass', 'yk_rawtokenvalue', 'abc123hash', 'k-123', 's-123', 'yk_zzz', 'youkeep_session']) {
      expect(text).not.toContain(leaked);
    }
    expect(JSON.parse(rows()[0].details)).toEqual({ reason: 'bad_credentials' });
  });

  it('truncates long values and never throws', () => {
    recordSecurityEvent(null, 'login_failed', { username: 'x'.repeat(5000), reason: 'r'.repeat(5000) });
    expect(rows()[0].username.length).toBeLessThanOrEqual(100);
    expect(rows()[0].details.length).toBeLessThan(600);
    (globalThis as any).getDb = () => { throw new Error('db down'); };
    expect(() => recordSecurityEvent(null, 'login_failed', {})).not.toThrow();
  });

  it(`keeps at most ${SECURITY_EVENT_MAX_ROWS} rows, dropping the oldest`, () => {
    const insert = db.prepare("INSERT INTO security_events (created_at, type) VALUES (?, 'old')");
    db.transaction(() => { for (let i = 0; i < SECURITY_EVENT_MAX_ROWS + 50; i++) insert.run(Date.now()); })();
    recordSecurityEvent(null, 'login_failed', { username: 'newest' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM security_events').get() as any).n).toBe(SECURITY_EVENT_MAX_ROWS);
    expect(ofType('login_failed')).toHaveLength(1);
  });
});

describe('retention', () => {
  it('purges events older than 90 days, from the hourly job too', () => {
    const insert = db.prepare('INSERT INTO security_events (created_at, type) VALUES (?, ?)');
    insert.run(Date.now() - SECURITY_EVENT_RETENTION_MS - 1000, 'ancient');
    insert.run(Date.now() - SECURITY_EVENT_RETENTION_MS + 60_000, 'recent');
    expect(purgeSecurityEvents()).toBe(1);
    insert.run(Date.now() - SECURITY_EVENT_RETENTION_MS - 1000, 'ancient');
    runAuthMaintenance();
    expect(rows().map((r) => r.type)).toEqual(['recent']);
    expect(SECURITY_EVENT_RETENTION_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});

describe('what gets recorded', () => {
  const setPassword = async (id: string, pw: string) => db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), id);

  it('login failures (unknown user, wrong password, rate limited) without the password', async () => {
    await setPassword('u1', 'right-password-1');
    const login = (username: string, password: string) =>
      loginPost(withIp(mockEvent(undefined, { method: 'POST', body: { username, password } }))).catch((e: any) => e);
    await login('ghost', 'some-guess-1');
    await login('user_u1', 'wrong-guess-2');
    for (let i = 0; i < 6; i++) await login('user_u1', 'wrong-guess-3');
    const failures = ofType('login_failed');
    expect(failures.length).toBeGreaterThanOrEqual(3);
    expect(failures[0]).toMatchObject({ username: 'ghost', ip: '192.0.2.10' });
    const reasons = failures.map((f) => JSON.parse(f.details).reason);
    expect(reasons).toContain('unknown_user');
    expect(reasons).toContain('wrong_password');
    expect(reasons).toContain('rate_limited');
    expect(JSON.stringify(rows())).not.toMatch(/guess/);
  }, 30_000);

  it('a successful login is recorded only from a new address', async () => {
    await setPassword('u1', 'right-password-1');
    const ok = (ip: string) => loginPost(withIp(mockEvent(undefined, { method: 'POST', body: { username: 'user_u1', password: 'right-password-1' } }), ip));
    await ok('192.0.2.10');
    await ok('192.0.2.10');
    await ok('198.51.100.7');
    expect(ofType('login_new_ip').map((r) => [r.user_id, r.ip])).toEqual([['u1', '192.0.2.10'], ['u1', '198.51.100.7']]);
    expect(isKnownLoginIp('u1', '192.0.2.10')).toBe(true);
    expect(isKnownLoginIp('u1', '203.0.113.1')).toBe(false);
  }, 30_000);

  it('password changes, token create/revoke, user create/role change/reset/delete', async () => {
    await setPassword('u1', 'old-password-1');
    const asU1 = (opts: any) => withIp(mockEvent(sessionCookie('s-u1'), opts));
    const asA1 = (opts: any) => withIp(mockEvent(sessionCookie('s-a1'), opts));

    const created: any = await tokensPost(asU1({ method: 'POST', body: { name: 'phone' } }));
    await tokenDelete(asU1({ method: 'DELETE', params: { id: created.id } }));
    await passwordPut(asU1({ method: 'PUT', body: { currentPassword: 'old-password-1', password: 'new-password-1' } }));
    const newUser: any = await usersPost(asA1({ method: 'POST', body: { username: 'carol', role: 'user' } }));
    await usersPut(asA1({ method: 'PUT', params: { id: newUser.userId }, body: { role: 'admin' } }));
    await usersPut(asA1({ method: 'PUT', params: { id: newUser.userId }, body: { password: 'admin-set-pass-1' } }));
    await usersReset(asA1({ method: 'POST', params: { id: newUser.userId } }));
    await usersDelete(asA1({ method: 'DELETE', params: { id: newUser.userId } }));

    expect(rows().map((r) => r.type)).toEqual([
      'token_created', 'token_revoked', 'password_changed', 'user_created', 'user_role_changed',
      'password_changed', 'password_reset', 'user_deleted',
    ]);
    expect(ofType('user_role_changed')[0]).toMatchObject({ user_id: 'a1' });
    expect(JSON.parse(ofType('user_role_changed')[0].details)).toMatchObject({ targetId: newUser.userId, from: 'user', to: 'admin' });
    expect(JSON.parse(ofType('token_created')[0].details)).toMatchObject({ tokenId: created.id, scope: 'read' });
    const text = JSON.stringify(rows());
    for (const secret of ['old-password-1', 'new-password-1', 'admin-set-pass-1', created.token, newUser.password]) {
      expect(text).not.toContain(secret);
    }
  }, 30_000);
});

describe('GET /api/admin/security-events', () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) recordSecurityEvent(null, 'login_failed', { username: `n${i}`, reason: 'wrong_password' });
  });

  it('returns the newest events first, limited', async () => {
    const res: any = await securityEventsGet(mockEvent(sessionCookie('s-a1'), { path: '/api/admin/security-events?limit=3' }));
    expect(res.events.map((e: any) => e.username)).toEqual(['n4', 'n3', 'n2']);
    expect(res.events[0]).toMatchObject({ type: 'login_failed', details: { reason: 'wrong_password' }, createdAt: expect.any(Number) });
    expect(listSecurityEvents(1000)).toHaveLength(5);
  });

  it('refuses members (403), guests (401) and API tokens (403)', async () => {
    const asUser: any = await securityEventsGet(mockEvent(sessionCookie('s-u1'))).catch((e: any) => e);
    expect(asUser.statusCode).toBe(403);
    const guest: any = await securityEventsGet(mockEvent()).catch((e: any) => e);
    expect(guest.statusCode).toBe(401);
    const { token } = createApiToken('a1', 'admin script', { scope: 'full' });
    const viaToken: any = await securityEventsGet(mockEvent(undefined, { headers: { authorization: `Bearer ${token}` } })).catch((e: any) => e);
    expect(viaToken.statusCode).toBe(403);
  });
});
