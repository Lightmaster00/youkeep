import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import resetPasswordHandler from '../../server/api/admin/users/[id]/reset-password.post';
import { requireAdmin, hashPassword } from '../../server/utils/auth';
import { createApiToken, getUserFromApiToken } from '../../server/utils/apiTokens';
import {
  createTestDb,
  insertUser,
  insertSession,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).hashPassword = hashPassword;
});

describe('POST /api/admin/users/[id]/reset-password', () => {
  it('revokes all of the target user\'s API tokens when an admin resets their password', async () => {
    insertUser(db, { id: 'admin1', role: 'admin' });
    insertSession(db, { id: 'sess-admin1', userId: 'admin1' });
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    expect(getUserFromApiToken(created.token)).not.toBeNull();

    const event = mockEvent(sessionCookie('sess-admin1'), {
      path: '/api/admin/users/u1/reset-password',
      params: { id: 'u1' }
    });
    const result: any = await resetPasswordHandler(event);
    expect(result.success).toBe(true);

    expect(getUserFromApiToken(created.token)).toBeNull();
  });
});
