import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import updateHandler from '../../server/api/admin/users/[id].put';
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

describe('PUT /api/admin/users/[id]', () => {
  it('revokes all of the target user\'s API tokens when an admin changes their password', async () => {
    insertUser(db, { id: 'admin1', role: 'admin' });
    insertSession(db, { id: 'sess-admin1', userId: 'admin1' });
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    expect(getUserFromApiToken(created.token)).not.toBeNull();

    const event = mockEvent(sessionCookie('sess-admin1'), {
      path: '/api/admin/users/u1',
      params: { id: 'u1' },
      body: { password: 'a-new-long-password' }
    });
    const result: any = await updateHandler(event);
    expect(result.success).toBe(true);

    expect(getUserFromApiToken(created.token)).toBeNull();
  });

  it('does not touch API tokens when no password change is requested', async () => {
    insertUser(db, { id: 'admin1', role: 'admin' });
    insertSession(db, { id: 'sess-admin1', userId: 'admin1' });
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    const event = mockEvent(sessionCookie('sess-admin1'), {
      path: '/api/admin/users/u1',
      params: { id: 'u1' },
      body: { role: 'user', channelAccess: [] }
    });
    const result: any = await updateHandler(event);
    expect(result.success).toBe(true);

    expect(getUserFromApiToken(created.token)).not.toBeNull();
  });
});
