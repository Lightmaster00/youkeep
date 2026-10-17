import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import passwordHandler from '../../server/api/account/password.put';
import loginHandler from '../../server/api/auth/login.post';
import updateHandler from '../../server/api/admin/users/[id].put';
import resetHandler from '../../server/api/admin/users/[id]/reset-password.post';
import forcePasswordChange from '../../server/middleware/forcePasswordChange';
import { requireAdmin, hashPassword } from '../../server/utils/auth';
import { resetAllLoginAttempts } from '../../server/utils/rateLimit';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).hashPassword = hashPassword;
  resetAllLoginAttempts();
  insertUser(db, { id: 'a1', role: 'admin' });
  insertSession(db, { id: 'sess-a1', userId: 'a1' });
});

function setPassword(userId: string, password: string) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 4), userId);
}
const sessionsOf = (userId: string) =>
  (db.prepare('SELECT id FROM sessions WHERE user_id = ? ORDER BY id').all(userId) as any[]).map((r) => r.id);

function changeOwnPassword(sessionId: string, body: unknown) {
  return passwordHandler(mockEvent(sessionCookie(sessionId), { method: 'PUT', body }));
}

function setCookies(event: any): string {
  const raw = event.node.res.getHeader('set-cookie');
  return Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
}

describe('PUT /api/account/password', () => {
  beforeEach(() => {
    insertUser(db, { id: 'u1', role: 'user' });
    setPassword('u1', 'old-password-1');
    insertSession(db, { id: 'sess-u1-here', userId: 'u1' });
    insertSession(db, { id: 'sess-u1-phone', userId: 'u1' });
    insertSession(db, { id: 'sess-u1-laptop', userId: 'u1' });
  });

  it('requires the current password', async () => {
    await expect(changeOwnPassword('sess-u1-here', { password: 'new-password-1' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(changeOwnPassword('sess-u1-here', { currentPassword: 'wrong-password', password: 'new-password-1' })).rejects.toMatchObject({ statusCode: 400 });
    // Unchanged: the old password still works.
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get('u1') as any;
    expect(bcrypt.compareSync('old-password-1', row.password_hash)).toBe(true);
  });

  it('refuses a new password equal to the current one (400), changing nothing', async () => {
    await expect(changeOwnPassword('sess-u1-here', { currentPassword: 'old-password-1', password: 'old-password-1' }))
      .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Choose a different password.' });
    expect(sessionsOf('u1')).toHaveLength(3);
  });

  it('a forced change refuses the temporary password as the new one', async () => {
    db.prepare("UPDATE users SET must_change_password = 1 WHERE id = 'u1'").run();
    await expect(changeOwnPassword('sess-u1-here', { currentPassword: 'old-password-1', password: 'old-password-1' }))
      .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Choose a different password.' });
    expect((db.prepare("SELECT must_change_password AS m FROM users WHERE id = 'u1'").get() as any).m).toBe(1);
  });

  it('rate-limits wrong current passwords like login (429 after 5)', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(changeOwnPassword('sess-u1-here', { currentPassword: `wrong-${i}-pw`, password: 'new-password-1' })).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(changeOwnPassword('sess-u1-here', { currentPassword: 'old-password-1', password: 'new-password-1' })).rejects.toMatchObject({ statusCode: 429 });
  });

  it('on success: signs out every other session, rotates the current one, revokes tokens', async () => {
    const event = mockEvent(sessionCookie('sess-u1-here'), { method: 'PUT', body: { currentPassword: 'old-password-1', password: 'new-password-1' } });
    await expect(passwordHandler(event)).resolves.toMatchObject({ success: true });

    const remaining = sessionsOf('u1');
    expect(remaining).toHaveLength(1);
    expect(remaining).not.toContain('sess-u1-phone');
    expect(remaining).not.toContain('sess-u1-laptop');
    expect(remaining).not.toContain('sess-u1-here');
    // The caller got the new session cookie (and a matching CSRF cookie).
    expect(setCookies(event)).toContain(`youkeep_session=${remaining[0]}`);
    expect(setCookies(event)).toContain('csrf_token=');
    // Other users are untouched.
    expect(sessionsOf('a1')).toEqual(['sess-a1']);
  });

  it('applies the shared password rules to the new password', async () => {
    await expect(changeOwnPassword('sess-u1-here', { currentPassword: 'old-password-1', password: 'short' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(changeOwnPassword('sess-u1-here', { currentPassword: 'old-password-1', password: 'x'.repeat(73) })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('admin password changes sign the target out everywhere', () => {
  beforeEach(() => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertSession(db, { id: 'sess-u1-a', userId: 'u1' });
    insertSession(db, { id: 'sess-u1-b', userId: 'u1' });
  });

  it('PUT /api/admin/users/:id with a password', async () => {
    await updateHandler(mockEvent(sessionCookie('sess-a1'), { method: 'PUT', params: { id: 'u1' }, body: { password: 'admin-chosen-pw' } }));
    expect(sessionsOf('u1')).toEqual([]);
    expect(sessionsOf('a1')).toEqual(['sess-a1']);
  });

  it('PUT /api/admin/users/:id without a password keeps the sessions', async () => {
    await updateHandler(mockEvent(sessionCookie('sess-a1'), { method: 'PUT', params: { id: 'u1' }, body: { role: 'user' } }));
    expect(sessionsOf('u1')).toHaveLength(2);
  });

  it('an admin cannot set their own password through the admin route (bypassing the current-password check)', async () => {
    await expect(updateHandler(mockEvent(sessionCookie('sess-a1'), { method: 'PUT', params: { id: 'a1' }, body: { password: 'admin-chosen-pw' } })))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('POST /api/admin/users/:id/reset-password', async () => {
    await resetHandler(mockEvent(sessionCookie('sess-a1'), { method: 'POST', params: { id: 'u1' } }));
    expect(sessionsOf('u1')).toEqual([]);
  });
});

describe('forced change after an admin reset, end to end', () => {
  it('the temporary password is the current password for the change', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    db.prepare("UPDATE users SET username = 'erin' WHERE id = 'u1'").run();

    const reset: any = await resetHandler(mockEvent(sessionCookie('sess-a1'), { method: 'POST', params: { id: 'u1' } }));
    const temp = reset.password as string;

    const login = mockEvent(undefined, { method: 'POST', body: { username: 'erin', password: temp } });
    login.node.req.socket = { remoteAddress: '10.1.1.1' };
    const res: any = await loginHandler(login);
    expect(res.user.mustChangePassword).toBe(true);
    const sid = sessionsOf('u1')[0]!;

    // Everything else is blocked, the password route is reachable.
    await expect(forcePasswordChange(mockEvent(sessionCookie(sid), { path: '/api/videos' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(forcePasswordChange(mockEvent(sessionCookie(sid), { path: '/api/account/password', method: 'PUT' }))).resolves.toBeUndefined();

    await expect(changeOwnPassword(sid, { currentPassword: temp, password: 'my-own-password' })).resolves.toMatchObject({ success: true });
    const row = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get('u1') as any;
    expect(row.must_change_password).toBe(0);

    const newSid = sessionsOf('u1')[0]!;
    await expect(forcePasswordChange(mockEvent(sessionCookie(newSid), { path: '/api/videos' }))).resolves.toBeUndefined();

    const relogin = mockEvent(undefined, { method: 'POST', body: { username: 'erin', password: 'my-own-password' } });
    relogin.node.req.socket = { remoteAddress: '10.1.1.1' };
    await expect(loginHandler(relogin)).resolves.toMatchObject({ success: true });
  });
});
