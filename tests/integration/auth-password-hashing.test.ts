import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import loginHandler from '../../server/api/auth/login.post';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH, requireAdmin, createSession } from '../../server/utils/auth';
import { resetAllLoginAttempts } from '../../server/utils/rateLimit';
import { createTestDb, mockEvent } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).hashPassword = hashPassword;
  (globalThis as any).createSession = createSession;
  resetAllLoginAttempts();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function loginEvent(username: string, password: string, ip = '10.0.0.1') {
  const event = mockEvent(undefined, {
    method: 'POST',
    path: '/api/auth/login',
    body: { username, password },
    headers: { 'content-type': 'application/json' }
  });
  event.node.req.socket = { remoteAddress: ip };
  return event;
}

describe('password hashing', () => {
  it('uses the async bcrypt API only (never the blocking sync one)', async () => {
    const hashSync = vi.spyOn(bcrypt, 'hashSync');
    const compareSync = vi.spyOn(bcrypt, 'compareSync');
    const hash = vi.spyOn(bcrypt, 'hash');
    const compare = vi.spyOn(bcrypt, 'compare');

    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);

    expect(hash).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledTimes(2);
    expect(hashSync).not.toHaveBeenCalled();
    expect(compareSync).not.toHaveBeenCalled();
  });

  it('runs a full bcrypt compare against a dummy hash when the user does not exist', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    await expect(loginHandler(loginEvent('nobody', 'whatever-password'))).rejects.toMatchObject({ statusCode: 401 });
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![1]).toBe(DUMMY_PASSWORD_HASH);
  });

  it('reports a missing hash as a mismatch even though the dummy compare ran', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
  });

  it('8 parallel failed logins do not stall the event loop for more than a single hash', async () => {
    let last = Date.now();
    let maxGap = 0;
    const timer = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 2);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        expect(loginHandler(loginEvent(`ghost${i}`, 'nope-nope', `10.0.1.${i}`))).rejects.toMatchObject({ statusCode: 401 })
      )
    );
    clearInterval(timer);
    maxGap = Math.max(maxGap, Date.now() - last);
    // Unserialized, the 8 compares run back to back in one loop phase (~400 ms).
    expect(maxGap).toBeLessThan(150);
  });
});
