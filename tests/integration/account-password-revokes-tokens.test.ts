import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import passwordHandler from '../../server/api/account/password.put';
import { createApiToken, getUserFromApiToken } from '../../server/utils/apiTokens';
import {
  createTestDb,
  insertUser,
  insertSession,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

// account/password.put.ts imports getDb directly from server/utils/db rather
// than relying on Nitro's auto-import global, so the usual
// `(globalThis as any).getDb = () => db` override (still set below, for
// createApiToken/getUserFromApiToken which DO use the auto-imported global)
// doesn't reach it — mock the module itself so both paths hit the same
// in-memory test db.
vi.mock('../../server/utils/db', () => ({
  getDb: () => (globalThis as any).getDb()
}));

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

describe('PUT /api/account/password', () => {
  it('revokes all of the caller\'s API tokens when the password is changed', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const sessionId = 'sess-u1';
    insertSession(db, { id: sessionId, userId: 'u1' });
    const created = createApiToken('u1', 'My Phone');

    expect(getUserFromApiToken(created.token)).not.toBeNull();

    const event = mockEvent(sessionCookie(sessionId), {
      path: '/api/account/password',
      body: { password: 'a-new-long-password' }
    });
    const result: any = await passwordHandler(event);
    expect(result.success).toBe(true);

    expect(getUserFromApiToken(created.token)).toBeNull();
  });
});
