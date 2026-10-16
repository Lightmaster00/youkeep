import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import forcePasswordChange from '../../server/middleware/forcePasswordChange';
import { createSession, MAX_SESSIONS_PER_USER } from '../../server/utils/auth';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertUser(db, { id: 'u1', role: 'user' });
});

describe('forcePasswordChange and the profile route', () => {
  beforeEach(() => {
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run('u1');
    insertSession(db, { id: 's1', userId: 'u1' });
  });

  it('still allows reading the profile', async () => {
    await expect(forcePasswordChange(mockEvent(sessionCookie('s1'), { path: '/api/account/profile', method: 'GET' }))).resolves.toBeUndefined();
  });

  it('blocks changing the profile until the password is changed', async () => {
    await expect(forcePasswordChange(mockEvent(sessionCookie('s1'), { path: '/api/account/profile', method: 'PUT' }))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('createSession', () => {
  it(`keeps at most ${20} sessions per user, dropping the oldest`, async () => {
    expect(MAX_SESSIONS_PER_USER).toBe(20);
    const base = Date.now();
    for (let i = 0; i < 25; i++) insertSession(db, { id: `old${String(i).padStart(2, '0')}`, userId: 'u1', expiresAt: base + i * 1000 });
    insertUser(db, { id: 'u2', role: 'user' });
    insertSession(db, { id: 'other-user', userId: 'u2', expiresAt: base - 5000 + 7 * 24 * 3600 * 1000 });

    const newId = await createSession('u1', mockEvent());

    const ids = (db.prepare("SELECT id FROM sessions WHERE user_id = 'u1'").all() as any[]).map((r) => r.id);
    expect(ids).toHaveLength(20);
    expect(ids).toContain(newId);
    // The 6 oldest are gone; the newest survive.
    for (let i = 0; i < 6; i++) expect(ids).not.toContain(`old${String(i).padStart(2, '0')}`);
    expect(ids).toContain('old24');
    expect(db.prepare("SELECT 1 FROM sessions WHERE id = 'other-user'").get()).toBeTruthy();
  });
});
