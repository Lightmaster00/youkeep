import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import setupHandler from '../../server/api/auth/setup.post';
import guards from '../../server/middleware/requestGuards';
import { getUserFromSession, verifyPassword } from '../../server/utils/auth';
import { createTestDb, insertUser, mockEvent, sessionCookie } from '../helpers/testDb';

// First-run setup: the only unauthenticated route that creates an account.
let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  mockEvent(undefined, { method: 'POST', path: '/api/auth/setup', body, headers });
const users = () => db.prepare('SELECT username, role, password_hash FROM users').all() as { username: string; role: string; password_hash: string }[];

describe('POST /api/auth/setup', () => {
  it('creates the first account as an admin, hashes its password and signs it in', async () => {
    const event = post({ username: 'Boss', password: 'first-admin-pw' });
    const r: any = await setupHandler(event);
    expect(r).toMatchObject({ success: true, user: { username: 'Boss', role: 'admin', mustChangePassword: false } });
    const [row] = users();
    expect(row).toMatchObject({ username: 'Boss', role: 'admin' });
    expect(row!.password_hash).not.toContain('first-admin-pw');
    expect(await verifyPassword('first-admin-pw', row!.password_hash)).toBe(true);
    const cookies = [event.node.res.headers['set-cookie']].flat().join('\n');
    const sid = /youkeep_session=([^;]+)/.exec(cookies)?.[1];
    expect(sid).toBeTruthy();
    expect(await getUserFromSession(mockEvent(sessionCookie(sid!)))).toMatchObject({ username: 'Boss', role: 'admin' });
  }, 30_000);

  it('is refused once any user exists (even a plain member), and creates nothing', async () => {
    insertUser(db, { id: 'm1', role: 'user' });
    await expect(setupHandler(post({ username: 'attacker', password: 'attacker-pw-1' }))).rejects.toMatchObject({ statusCode: 400 });
    expect(users().map((u) => u.username)).toEqual(['user_m1']);
  }, 30_000);

  it('a second setup after the first is refused', async () => {
    await setupHandler(post({ username: 'boss', password: 'first-admin-pw' }));
    await expect(setupHandler(post({ username: 'second', password: 'second-admin-pw' }))).rejects.toMatchObject({ statusCode: 400 });
    expect(users().map((u) => u.username)).toEqual(['boss']);
  }, 30_000);

  it('two concurrent setups create exactly one admin', async () => {
    const results = await Promise.allSettled([
      setupHandler(post({ username: 'one', password: 'first-admin-pw' })),
      setupHandler(post({ username: 'two', password: 'second-admin-pw' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(users()).toHaveLength(1);
  }, 30_000);

  it.each([
    [{}, 'missing fields'],
    [{ username: '', password: 'first-admin-pw' }, 'empty username'],
    [{ username: 'boss', password: 'short' }, 'short password'],
    [{ username: 'a/b', password: 'first-admin-pw' }, 'invalid username'],
  ])('refuses %j (%s) with a 400 and creates nothing', async (body) => {
    await expect(setupHandler(post(body))).rejects.toMatchObject({ statusCode: 400 });
    expect(users()).toEqual([]);
  });

  it('cross-site setup requests are refused by the request guards before the route runs', async () => {
    const headers = { 'content-type': 'application/json', 'content-length': '40', host: 'media.example.com' };
    for (const extra of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://evil.example' }]) {
      for (const p of ['/api/auth/setup', '/api/auth/setup/', '/API/auth/setup?x=1']) {
        await expect(guards(mockEvent(undefined, { method: 'POST', path: p, headers: { ...headers, ...extra } }))).rejects.toMatchObject({ statusCode: 403 });
      }
    }
  });
});
