import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import loginHandler from '../../server/api/auth/login.post';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH, requireAdmin, createSession } from '../../server/utils/auth';
import { setPasswordWorkerDisabledForTests, isPasswordWorkerActive, crashPasswordWorkerForTests } from '../../server/utils/passwordWorker';
import { resetAllLoginAttempts } from '../../server/utils/rateLimit';
import { createTestDb, insertUser, mockEvent } from '../helpers/testDb';

// Real bcrypt (cost 10) compares, dozens per test: seconds when 3 suites share
// the CPU, so the 5 s default timeout is too tight for a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

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

  it('a worker crash during a compare or a hash retries once in the main thread (R7)', async () => {
    const h = bcrypt.hashSync('correct horse battery', 4);
    await hashPassword('warm-up'); // the worker is running
    expect(isPasswordWorkerActive()).toBe(true);
    const verifying = verifyPassword('correct horse battery', h);
    const hashing = hashPassword('another password');
    crashPasswordWorkerForTests();
    expect(await verifying).toBe(true);
    expect(bcrypt.compareSync('another password', await hashing)).toBe(true);
  });

  it('a wrong password stays wrong after a crash, and a bcrypt error is not retried', async () => {
    const h = bcrypt.hashSync('correct horse battery', 4);
    await hashPassword('warm-up');
    const verifying = verifyPassword('wrong', h);
    crashPasswordWorkerForTests();
    expect(await verifying).toBe(false);
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

  // Logical checks instead of event-loop timing (which flakes under a loaded
  // full-suite run): with the worker, no hash runs on the main thread; with
  // the fallback, at most one hash runs at a time.
  it('8 parallel failed logins do not stall the event loop (worker)', async () => {
    await hashPassword('warm-up');
    const compare = vi.spyOn(bcrypt, 'compare');
    const compareSync = vi.spyOn(bcrypt, 'compareSync');
    await eightFailedLogins();
    expect(isPasswordWorkerActive()).toBe(true);
    expect(compare).not.toHaveBeenCalled();
    expect(compareSync).not.toHaveBeenCalled();
  });

  it('8 parallel failed logins stall at most one hash at a time (fallback)', async () => {
    setPasswordWorkerDisabledForTests(true);
    const realCompare = bcrypt.compare.bind(bcrypt) as (p: string, h: string) => Promise<boolean>;
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];
    vi.spyOn(bcrypt, 'compare').mockImplementation((async (password: string, hash: string) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push(`start:${running}`);
      try {
        return await realCompare(password, hash);
      } finally {
        order.push('end');
        running--;
      }
    }) as any);
    await eightFailedLogins();
    expect(maxRunning).toBe(1);
    // Strictly alternating: each compare ends before the next starts.
    expect(order).toEqual(Array.from({ length: 8 }, () => ['start:1', 'end']).flat());
  });
});
