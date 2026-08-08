import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import loginHandler from '../../server/api/dev/login.post';
import { createTestDb, mockEvent } from '../helpers/testDb';
import { hashPassword, createSession } from '../../server/utils/auth';

let db: Database.Database;
let originalNodeEnv: string | undefined;
let originalAllowDevLogin: string | undefined;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  // login.post.ts calls hashPassword/createSession as bare ambient
  // identifiers (Nitro auto-import at build time). The test imports the
  // module directly via a relative path, bypassing that transform, so the
  // real implementations must be wired onto globalThis the same way getDb
  // is above — otherwise these calls throw ReferenceError.
  (globalThis as any).hashPassword = hashPassword;
  (globalThis as any).createSession = createSession;
  originalNodeEnv = process.env.NODE_ENV;
  originalAllowDevLogin = process.env.ALLOW_DEV_LOGIN;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.ALLOW_DEV_LOGIN = originalAllowDevLogin;
});

describe('POST /api/dev/login', () => {
  it('404s when NODE_ENV is production, even with ALLOW_DEV_LOGIN=1', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_LOGIN = '1';

    await expect(loginHandler(mockEvent(undefined, { path: '/api/dev/login' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s when ALLOW_DEV_LOGIN is not set, even when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_DEV_LOGIN;

    await expect(loginHandler(mockEvent(undefined, { path: '/api/dev/login' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s when ALLOW_DEV_LOGIN is set to a wrong value', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_LOGIN = 'true'; // not the exact string '1'

    await expect(loginHandler(mockEvent(undefined, { path: '/api/dev/login' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('creates the fixture user and returns a session cookie when both conditions are met', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_LOGIN = '1';

    const event = mockEvent(undefined, { path: '/api/dev/login' });
    const result: any = await loginHandler(event);

    expect(result.success).toBe(true);
    expect(result.username).toBe('dev-fixture-admin');

    const user = db.prepare("SELECT id, role FROM users WHERE username = 'dev-fixture-admin'").get() as any;
    expect(user).toBeDefined();
    expect(user.role).toBe('admin');

    const setCookieHeader = event.node.res.getHeader('set-cookie');
    expect(setCookieHeader).toBeDefined();
    expect(String(setCookieHeader)).toContain('youkeep_session=');
  });

  it('reuses the same fixture user on a second call instead of creating a duplicate', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_LOGIN = '1';

    await loginHandler(mockEvent(undefined, { path: '/api/dev/login' }));
    await loginHandler(mockEvent(undefined, { path: '/api/dev/login' }));

    const count = (db.prepare("SELECT COUNT(*) as count FROM users WHERE username = 'dev-fixture-admin'").get() as { count: number }).count;
    expect(count).toBe(1);
  });
});
