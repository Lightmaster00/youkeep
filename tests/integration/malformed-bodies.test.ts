import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import loginHandler from '../../server/api/auth/login.post';
import setupHandler from '../../server/api/auth/setup.post';
import profileHandler from '../../server/api/account/profile.put';
import preferencesHandler from '../../server/api/account/preferences.put';
import tokensPostHandler from '../../server/api/account/tokens/index.post';
import passwordHandler from '../../server/api/account/password.put';
import { resetAllLoginAttempts } from '../../server/utils/rateLimit';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  resetAllLoginAttempts();
  insertUser(db, { id: 'u1', role: 'user' });
  insertSession(db, { id: 'sess-u1', userId: 'u1' });
});

const NON_OBJECT_BODIES: unknown[] = [null, [], ['a'], 'text', 7];

function call(handler: (e: any) => any, body: unknown, cookie?: string) {
  const event = mockEvent(cookie, { method: 'POST', body });
  event.node.req.socket = { remoteAddress: '10.9.9.9' };
  return handler(event);
}

async function expect400(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ statusCode: 400 });
}

describe('malformed request bodies are a 400, never a 500', () => {
  it.each(NON_OBJECT_BODIES)('login: %j', async (body) => expect400(call(loginHandler, body)));
  it.each([
    { username: { a: 1 }, password: 'x' },
    { username: 'bob', password: 12345678 },
    { username: ['bob'], password: ['pw'] },
  ])('login fields of the wrong type: %j', async (body) => expect400(call(loginHandler, body)));

  it.each(NON_OBJECT_BODIES)('setup: %j', async (body) => {
    db.prepare('DELETE FROM users').run();
    await expect400(call(setupHandler, body));
  });
  it.each([
    { username: 123, password: 'long-enough-pw' },
    { username: 'admin', password: 12345678 },
    { username: 'a'.repeat(100000), password: 'long-enough-pw' },
    { username: '   ', password: 'long-enough-pw' },
  ])('setup fields: %j', async (body) => {
    db.prepare('DELETE FROM users').run();
    await expect400(call(setupHandler, body));
  });

  it.each(NON_OBJECT_BODIES)('profile: %j', async (body) => expect400(call(profileHandler, body, sessionCookie('sess-u1'))));
  it.each([{ email: 5 }, { phone: {} }, { dob: ['2020-01-01'] }, { firstName: 'x'.repeat(101) }])('profile fields: %j', async (body) =>
    expect400(call(profileHandler, body, sessionCookie('sess-u1'))));

  it.each(NON_OBJECT_BODIES)('preferences: %j', async (body) => expect400(call(preferencesHandler, body, sessionCookie('sess-u1'))));
  it.each(NON_OBJECT_BODIES)('password change: %j', async (body) => expect400(call(passwordHandler, body, sessionCookie('sess-u1'))));
  it.each([{ currentPassword: 1, password: 'long-enough-pw' }, { currentPassword: 'x', password: 12345678 }, { currentPassword: ['x'], password: ['y'] }])(
    'password change fields: %j', async (body) => expect400(call(passwordHandler, body, sessionCookie('sess-u1'))));
  it.each(NON_OBJECT_BODIES)('token creation: %j', async (body) => expect400(call(tokensPostHandler, body, sessionCookie('sess-u1'))));
});
