import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import loginHandler from '../../server/api/auth/login.post';
import { isSecureRequest } from '../../server/utils/auth';
import { getClientIp } from '../../server/utils/trustProxy';
import {
  resetAllLoginAttempts, recordFailedLogin, trackedLoginKeys, MAX_TRACKED_KEYS
} from '../../server/utils/rateLimit';
import { createTestDb, insertUser, mockEvent } from '../helpers/testDb';

// Real bcrypt (cost 10) compares, dozens per test: seconds when 3 suites share
// the CPU, so the 5 s default timeout is too tight for a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

let db: Database.Database;
const originalTrust = process.env.TRUST_PROXY;
const originalSecure = process.env.COOKIE_SECURE;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  resetAllLoginAttempts();
  delete process.env.TRUST_PROXY;
  delete process.env.COOKIE_SECURE;
  insertUser(db, { id: 'u1', role: 'user' });
  db.prepare("UPDATE users SET username = 'alice', password_hash = ? WHERE id = 'u1'").run(bcrypt.hashSync('right-password', 4));
});

afterEach(() => {
  if (originalTrust === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = originalTrust;
  if (originalSecure === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = originalSecure;
});

function login(username: string, password: string, opts: { socket?: string; xff?: string } = {}) {
  const event = mockEvent(undefined, {
    method: 'POST',
    body: { username, password },
    headers: opts.xff ? { 'x-forwarded-for': opts.xff } : {}
  });
  event.node.req.socket = { remoteAddress: opts.socket ?? '172.17.0.1' };
  return loginHandler(event);
}

const ipEvent = (xff: string | undefined, socket = '172.17.0.1') => {
  const e = mockEvent(undefined, { headers: xff ? { 'x-forwarded-for': xff } : {} });
  e.node.req.socket = { remoteAddress: socket };
  return e;
};

describe('client IP and TRUST_PROXY', () => {
  it('ignores X-Forwarded-For without TRUST_PROXY', () => {
    expect(getClientIp(ipEvent('1.2.3.4'))).toBe('172.17.0.1');
  });

  it('takes the rightmost entry with TRUST_PROXY=true (never the forgeable leftmost)', () => {
    process.env.TRUST_PROXY = 'true';
    expect(getClientIp(ipEvent('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9');
    expect(getClientIp(ipEvent('6.6.6.6,, 203.0.113.9 ,'))).toBe('203.0.113.9');
  });

  it('takes the Nth entry from the right with TRUST_PROXY=N', () => {
    process.env.TRUST_PROXY = '2';
    expect(getClientIp(ipEvent('6.6.6.6, 203.0.113.9, 10.0.0.2'))).toBe('203.0.113.9');
  });

  it('falls back to the socket address when the header is missing', () => {
    process.env.TRUST_PROXY = '1';
    expect(getClientIp(ipEvent(undefined, '10.0.0.7'))).toBe('10.0.0.7');
  });

  it('honours X-Forwarded-Proto for Secure cookies only with TRUST_PROXY', () => {
    const e = mockEvent(undefined, { headers: { 'x-forwarded-proto': 'https' } });
    expect(isSecureRequest(e)).toBe(false);
    process.env.TRUST_PROXY = 'true';
    expect(isSecureRequest(e)).toBe(true);
  });
});

describe('login rate limiting', () => {
  it('rotating a spoofed leftmost X-Forwarded-For entry does not bypass the limit', async () => {
    process.env.TRUST_PROXY = 'true';
    for (let i = 0; i < 5; i++) {
      await expect(login('alice', `wrong-${i}`, { xff: `9.9.9.${i}, 203.0.113.9` })).rejects.toMatchObject({ statusCode: 401 });
    }
    await expect(login('alice', 'right-password', { xff: '9.9.9.200, 203.0.113.9' })).rejects.toMatchObject({ statusCode: 429 });
  });

  it('locks an address after 30 failures spread over many usernames', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(login(`user${i}`, 'guess-password')).rejects.toMatchObject({ statusCode: 401 });
    }
    await expect(login('alice', 'right-password')).rejects.toMatchObject({ statusCode: 429 });
    // Another address is not affected.
    await expect(login('alice', 'right-password', { socket: '10.0.0.99' })).resolves.toMatchObject({ success: true });
  });

  it('refuses a correct password during a lockout, with a TRUST_PROXY hint when it is not set', async () => {
    for (let i = 0; i < 5; i++) await expect(login('alice', `wrong-${i}`)).rejects.toMatchObject({ statusCode: 401 });
    const err: any = await login('alice', 'right-password').catch((e) => e);
    expect(err.statusCode).toBe(429);
    expect(err.statusMessage).toContain('TRUST_PROXY');
  });

  it('a burst of parallel attempts cannot exceed the limit', async () => {
    const results = await Promise.allSettled([
      ...Array.from({ length: 5 }, (_, i) => login('alice', `wrong-${i}`)),
      login('alice', 'right-password')
    ]);
    const last = results[5] as PromiseRejectedResult;
    expect(last.status).toBe('rejected');
    expect(last.reason.statusCode).toBe(429);
  });

  it('a success clears the username counter but not the address counter', async () => {
    for (let i = 0; i < 4; i++) await expect(login('alice', `wrong-${i}`)).rejects.toMatchObject({ statusCode: 401 });
    await expect(login('alice', 'right-password')).resolves.toMatchObject({ success: true });
    for (let i = 0; i < 4; i++) await expect(login('alice', `wrong-again-${i}`)).rejects.toMatchObject({ statusCode: 401 });
    await expect(login('alice', 'right-password')).resolves.toMatchObject({ success: true });
    // 8 failures so far on this address; 22 more over other names lock it.
    for (let i = 0; i < 22; i++) await expect(login(`spray${i}`, 'x-password')).rejects.toMatchObject({ statusCode: 401 });
    await expect(login('alice', 'right-password')).rejects.toMatchObject({ statusCode: 429 });
  });

  it('caps the number of tracked keys', () => {
    for (let i = 0; i < MAX_TRACKED_KEYS + 50; i++) recordFailedLogin(`k${i}`);
    expect(trackedLoginKeys()).toBeLessThanOrEqual(MAX_TRACKED_KEYS);
  });
});
