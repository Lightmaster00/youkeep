import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/account/tokens/index.get';
import postHandler from '../../server/api/account/tokens/index.post';
import deleteHandler from '../../server/api/account/tokens/[id].delete';
import { createApiToken } from '../../server/utils/apiTokens';
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
});

// Inserts the user + a session for them and returns a mockEvent. Call this
// at most once per userId within a single test — a second call would
// violate the users table's PRIMARY KEY/UNIQUE constraints. Where a test
// needs a second request as the same already-logged-in user (e.g. delete
// then re-list), reuse the same returned event object across both handler
// calls instead of calling this again.
function loginAs(userId: string, opts?: { path?: string; params?: Record<string, string>; body?: any }) {
  insertUser(db, { id: userId, role: 'user' });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId), {
    path: opts?.path ?? '/api/account/tokens',
    params: opts?.params,
    body: opts?.body
  });
}

describe('POST /api/account/tokens', () => {
  it('creates a token and returns it exactly once', async () => {
    const event = loginAs('u1', { body: { label: 'My Phone' } });

    const result: any = await postHandler(event);
    expect(result.label).toBe('My Phone');
    expect(result.token).toMatch(/^yk_/);
    expect(result.id).toBeTruthy();
  });

  it('rejects an empty label with 400', async () => {
    const event = loginAs('u1', { body: { label: '' } });
    await expect(postHandler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a label over 100 characters with 400', async () => {
    const event = loginAs('u1', { body: { label: 'x'.repeat(101) } });
    await expect(postHandler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an unauthenticated request with 401', async () => {
    const event = mockEvent(undefined, { path: '/api/account/tokens', body: { label: 'My Phone' } });
    await expect(postHandler(event)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('GET /api/account/tokens', () => {
  it('lists only the current user\'s tokens, never the raw token or hash', async () => {
    const event = loginAs('u1');
    insertUser(db, { id: 'u2', role: 'user' });
    createApiToken('u1', 'Phone');
    createApiToken('u2', 'Tablet');

    const result: any = await getHandler(event);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].label).toBe('Phone');
    expect(JSON.stringify(result)).not.toMatch(/yk_/);
  });

  it('returns an empty list for a user with no tokens', async () => {
    const event = loginAs('u1');
    const result: any = await getHandler(event);
    expect(result.tokens).toEqual([]);
  });
});

describe('DELETE /api/account/tokens/[id]', () => {
  it('revokes a token owned by the caller', async () => {
    const event = loginAs('u1');
    const created = createApiToken('u1', 'Phone');
    event.context.params = { id: created.id };

    const result: any = await deleteHandler(event);
    expect(result.success).toBe(true);

    // Reuse the same event for the follow-up list check — getHandler reads
    // only the session cookie and ignores context.params, so this is a
    // second, independent call as the same already-authenticated user
    // without a second loginAs('u1') (which would double-insert the user).
    const listResult: any = await getHandler(event);
    expect(listResult.tokens).toEqual([]);
  });

  it('returns 404 for a token owned by another user', async () => {
    const event = loginAs('u1');
    insertUser(db, { id: 'other-user', role: 'user' });
    const created = createApiToken('other-user', 'Their Phone');
    event.context.params = { id: created.id };

    await expect(deleteHandler(event)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 for a nonexistent token id', async () => {
    const event = loginAs('u1');
    event.context.params = { id: 'does-not-exist' };

    await expect(deleteHandler(event)).rejects.toMatchObject({ statusCode: 404 });
  });
});
