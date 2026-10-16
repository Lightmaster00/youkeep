import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import loginHandler from '../../server/api/auth/login.post';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH, requireAdmin, createSession } from '../../server/utils/auth';
import { setPasswordWorkerDisabledForTests, isPasswordWorkerActive } from '../../server/utils/passwordWorker';
import { resetAllLoginAttempts } from '../../server/utils/rateLimit';
import { createTestDb, insertUser, mockEvent } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).hashPassword = hashPassword;
  (globalThis as any).createSession = createSession;
  resetAllLoginAttempts();
  setPasswordWorkerDisabledForTests(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  setPasswordWorkerDisabledForTests(false);
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

async function maxLoopGap(work: () => Promise<unknown>): Promise<number> {
  let last = Date.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 2);
  await work();
  clearInterval(timer);
  return Math.max(maxGap, Date.now() - last);
}

const eightFailedLogins = () => Promise.all(
  Array.from({ length: 8 }, (_, i) =>
    expect(loginHandler(loginEvent(`ghost${i}`, 'nope-nope', `10.0.1.${i}`))).rejects.toMatchObject({ statusCode: 401 })
  )
);

describe('password hashing', () => {
  it('hashes and verifies in a worker thread, never with the blocking sync API on the main thread', async () => {
    const hashSync = vi.spyOn(bcrypt, 'hashSync');
    const compareSync = vi.spyOn(bcrypt, 'compareSync');

    const h = await hashPassword('correct horse battery');
    expect(isPasswordWorkerActive()).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(bcrypt.compareSync('correct horse battery', h)).toBe(true); // a real bcrypt hash
    hashSync.mockClear();
    compareSync.mockClear();

    await hashPassword('x-password');
    await verifyPassword('x-password', h);
    expect(hashSync).not.toHaveBeenCalled();
    expect(compareSync).not.toHaveBeenCalled();
  });

  it('the in-thread fallback awaits the async bcryptjs API', async () => {
    setPasswordWorkerDisabledForTests(true);
    const hashSync = vi.spyOn(bcrypt, 'hashSync');
    const compareSync = vi.spyOn(bcrypt, 'compareSync');
    const hash = vi.spyOn(bcrypt, 'hash');
    const compare = vi.spyOn(bcrypt, 'compare');

    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(hash).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(hashSync).not.toHaveBeenCalled();
    expect(compareSync).not.toHaveBeenCalled();
  });

  it('runs a full bcrypt compare (against the dummy hash) when the user does not exist', async () => {
    // Fallback path, where the call is observable.
    setPasswordWorkerDisabledForTests(true);
    const compare = vi.spyOn(bcrypt, 'compare');
    await expect(loginHandler(loginEvent('nobody', 'whatever-password'))).rejects.toMatchObject({ statusCode: 401 });
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![1]).toBe(DUMMY_PASSWORD_HASH);
  });

  it('an unknown username costs a full hash in the worker too (no timing oracle)', async () => {
    await hashPassword('warm-up'); // start the worker
    const t0 = Date.now();
    await expect(loginHandler(loginEvent('nobody', 'whatever-password'))).rejects.toMatchObject({ statusCode: 401 });
    // A cost-10 bcrypt compare takes tens of milliseconds; skipping it takes ~1 ms.
    expect(Date.now() - t0).toBeGreaterThan(20);
  });

  it('reports a missing hash as a mismatch even though the dummy compare ran', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
  });

  it('8 parallel failed logins do not stall the event loop (worker)', async () => {
    await hashPassword('warm-up');
    expect(await maxLoopGap(eightFailedLogins)).toBeLessThan(100);
  });

  it('8 parallel failed logins stall at most one hash at a time (fallback)', async () => {
    setPasswordWorkerDisabledForTests(true);
    // Unserialized, the 8 compares run back to back in one loop phase (~400 ms).
    expect(await maxLoopGap(eightFailedLogins)).toBeLessThan(150);
  });
});
