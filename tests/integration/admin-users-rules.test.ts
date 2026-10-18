import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import createHandler from '../../server/api/admin/users/index.post';
import updateHandler from '../../server/api/admin/users/[id].put';
import deleteHandler from '../../server/api/admin/users/[id].delete';
import resetHandler from '../../server/api/admin/users/[id]/reset-password.post';
import listHandler from '../../server/api/admin/users/index.get';
import { requireAdmin, hashPassword } from '../../server/utils/auth';
import { createTestDb, insertUser, insertSession, insertChannel, grantChannelAccess, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).hashPassword = hashPassword;
  insertUser(db, { id: 'a1', role: 'admin' });
  insertSession(db, { id: 'sess-a1', userId: 'a1' });
});

function asAdmin(handler: (e: any) => any, opts: { id?: string; body?: unknown; method?: string; session?: string } = {}) {
  const event = mockEvent(sessionCookie(opts.session ?? 'sess-a1'), {
    method: opts.method ?? 'POST',
    params: opts.id ? { id: opts.id } : {},
    ...(Object.prototype.hasOwnProperty.call(opts, 'body') ? { body: opts.body } : {})
  });
  return handler(event);
}

const role = (id: string) => (db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any)?.role;
const adminCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as any).n;

describe('last admin and self protection', () => {
  it('refuses self-demotion', async () => {
    insertUser(db, { id: 'a2', role: 'admin' });
    await expect(asAdmin(updateHandler, { id: 'a1', method: 'PUT', body: { role: 'user' } })).rejects.toMatchObject({ statusCode: 409 });
    expect(role('a1')).toBe('admin');
  });

  it('refuses a demotion that would leave zero admins (409, checked in the transaction)', async () => {
    // a2 is the only other admin; a1 demoted first by a2, then a1 (now stale) tries to demote a2.
    insertUser(db, { id: 'a2', role: 'admin' });
    insertSession(db, { id: 'sess-a2', userId: 'a2' });
    await asAdmin(updateHandler, { id: 'a1', method: 'PUT', body: { role: 'user' }, session: 'sess-a2' });
    expect(adminCount()).toBe(1);
    // a1 is no longer an admin: rejected by requireAdmin.
    await expect(asAdmin(updateHandler, { id: 'a2', method: 'PUT', body: { role: 'user' } })).rejects.toMatchObject({ statusCode: 403 });
    expect(adminCount()).toBe(1);
  });

  it('refuses deleting the last admin even via a race where the caller was demoted meanwhile', async () => {
    insertUser(db, { id: 'a2', role: 'admin' });
    // Simulate: caller passed requireAdmin, then got demoted before the delete ran.
    const event = mockEvent(sessionCookie('sess-a1'), { method: 'DELETE', params: { id: 'a2' } });
    const pending = deleteHandler(event);
    db.prepare("UPDATE users SET role = 'user' WHERE id = 'a1'").run();
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
    expect(role('a2')).toBe('admin');
  });

  it('refuses demoting the last admin via PUT when the caller was demoted meanwhile (409)', async () => {
    insertUser(db, { id: 'a2', role: 'admin' });
    // The caller passed requireSessionAdmin, then lost the admin role before the update ran.
    const event = mockEvent(sessionCookie('sess-a1'), { method: 'PUT', params: { id: 'a2' }, body: { role: 'user' } });
    const pending = updateHandler(event);
    db.prepare("UPDATE users SET role = 'user' WHERE id = 'a1'").run();
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
    expect(role('a2')).toBe('admin');
    expect(adminCount()).toBe(1);
  });

  it('allows deleting another admin while one remains, and deleting a user named "admin"', async () => {
    insertUser(db, { id: 'a2', role: 'admin' });
    await expect(asAdmin(deleteHandler, { id: 'a2', method: 'DELETE' })).resolves.toMatchObject({ success: true });
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('fake', 'admin', 'x', 'user', 0)").run();
    await expect(asAdmin(deleteHandler, { id: 'fake', method: 'DELETE' })).resolves.toMatchObject({ success: true });
  });

  it('refuses self-deletion', async () => {
    await expect(asAdmin(deleteHandler, { id: 'a1', method: 'DELETE' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('a user named "admin" can have their password reset; an admin cannot reset their own here', async () => {
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('fake', 'admin', 'x', 'user', 0)").run();
    await expect(asAdmin(resetHandler, { id: 'fake' })).resolves.toMatchObject({ success: true });
    await expect(asAdmin(resetHandler, { id: 'a1' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('PUT /api/admin/users/:id field handling', () => {
  beforeEach(() => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertChannel(db, { id: 'c1', visibility: 'ultra_private' });
    insertChannel(db, { id: 'c2', visibility: 'ultra_private' });
    grantChannelAccess(db, 'u1', 'c1');
  });
  const access = () => (db.prepare('SELECT channel_id FROM user_channel_access WHERE user_id = ? ORDER BY channel_id').all('u1') as any[]).map((r) => r.channel_id);

  it('keeps channel access when channelAccess is not sent (password-only change)', async () => {
    await asAdmin(updateHandler, { id: 'u1', method: 'PUT', body: { password: 'a-new-long-password' } });
    expect(access()).toEqual(['c1']);
  });

  it('replaces channel access when channelAccess is an array', async () => {
    await asAdmin(updateHandler, { id: 'u1', method: 'PUT', body: { channelAccess: ['c2'] } });
    expect(access()).toEqual(['c2']);
  });

  it('promoting a user to admin clears their channel grants (even if an array is sent)', async () => {
    await asAdmin(updateHandler, { id: 'u1', method: 'PUT', body: { role: 'admin', channelAccess: ['c2'] } });
    expect(role('u1')).toBe('admin');
    expect(access()).toEqual([]);
  });

  it('unknown channel ids are a 400 and change nothing', async () => {
    await expect(asAdmin(updateHandler, { id: 'u1', method: 'PUT', body: { channelAccess: ['c2', 'nope'] } })).rejects.toMatchObject({ statusCode: 400 });
    expect(access()).toEqual(['c1']);
  });

  it.each([
    null, [], 'x',
    { role: 'root' },
    { password: 12345678 },
    { password: 'short' },
    { channelAccess: 'c1' },
    { channelAccess: [1] },
  ])('malformed body %j is a 400', async (body) => {
    await expect(asAdmin(updateHandler, { id: 'u1', method: 'PUT', body })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('GET /api/admin/users', () => {
  it("lists every user with their own channel grants, and never a password hash", async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertUser(db, { id: 'u2', role: 'user' });
    insertChannel(db, { id: 'c1', visibility: 'ultra_private' });
    insertChannel(db, { id: 'c2', visibility: 'ultra_private' });
    grantChannelAccess(db, 'u1', 'c1');
    grantChannelAccess(db, 'u1', 'c2');
    grantChannelAccess(db, 'u2', 'c2');
    const r: any = await asAdmin(listHandler, { method: 'GET' });
    const byId = Object.fromEntries(r.users.map((u: any) => [u.id, u]));
    expect(Object.keys(byId).sort()).toEqual(['a1', 'u1', 'u2']);
    expect(byId.u1.channelAccess.sort()).toEqual(['c1', 'c2']);
    expect(byId.u2.channelAccess).toEqual(['c2']);
    expect(byId.a1.channelAccess).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('password');
  });

  it('is refused to a member', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertSession(db, { id: 'sess-u1', userId: 'u1' });
    await expect(asAdmin(listHandler, { method: 'GET', session: 'sess-u1' })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('POST /api/admin/users validation', () => {
  it('enforces the username rules and case-insensitive uniqueness', async () => {
    await expect(asAdmin(createHandler, { body: { username: 'Bob', role: 'user', password: 'long-enough-pw' } })).resolves.toMatchObject({ success: true });
    await expect(asAdmin(createHandler, { body: { username: 'bob', role: 'user' } })).rejects.toMatchObject({ statusCode: 409 });
    await expect(asAdmin(createHandler, { body: { username: ' BOB ', role: 'user' } })).rejects.toMatchObject({ statusCode: 409 });
    await expect(asAdmin(createHandler, { body: { username: 'ＢＯＢ', role: 'user' } })).rejects.toMatchObject({ statusCode: 409 });
    for (const username of [123, '', '   ', 'x'.repeat(100000), 'a\u0000b']) {
      await expect(asAdmin(createHandler, { body: { username, role: 'user' } })).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('stores the normalized username', async () => {
    const res: any = await asAdmin(createHandler, { body: { username: '  carol  ', role: 'user' } });
    expect((db.prepare('SELECT username FROM users WHERE id = ?').get(res.userId) as any).username).toBe('carol');
  });

  it('applies the password rules to an admin-chosen password', async () => {
    await expect(asAdmin(createHandler, { body: { username: 'dave', role: 'user', password: '1' } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(asAdmin(createHandler, { body: { username: 'dave', role: 'user', password: 'x'.repeat(73) } })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('unknown channelAccess ids are a 400 and create nothing', async () => {
    await expect(asAdmin(createHandler, { body: { username: 'erin', role: 'user', channelAccess: ['ghost'] } })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.prepare("SELECT 1 FROM users WHERE username = 'erin'").get()).toBeUndefined();
  });

  it.each([null, [], 'x', { username: 'x', role: 7 }])('malformed body %j is a 400', async (body) => {
    await expect(asAdmin(createHandler, { body })).rejects.toMatchObject({ statusCode: 400 });
  });
});
