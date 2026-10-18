import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isLoginLocked, recordFailedLogin, clearLoginAttempts, resetAllLoginAttempts,
  loginUserKey, loginLockStatus, recordFailedLoginAttempt,
} from '../../server/utils/rateLimit';

describe('rateLimit', () => {
  const key = 'test-key';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetAllLoginAttempts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks out on the 5th failed attempt within the window, not before, per key (e.g. per ip:username)', () => {
    expect(isLoginLocked(key).locked).toBe(false);
    for (let i = 0; i < 4; i++) recordFailedLogin(key);
    expect(isLoginLocked(key).locked).toBe(false);
    recordFailedLogin(key);
    const status = isLoginLocked(key);
    expect(status.locked).toBe(true);
    expect(status.retryAfterMs).toBeGreaterThan(0);
    expect(isLoginLocked('other-key').locked).toBe(false);
  });

  it('unlocks again once the lockout duration has elapsed', () => {
    for (let i = 0; i < 5; i++) recordFailedLogin(key);
    expect(isLoginLocked(key).locked).toBe(true);

    vi.setSystemTime(16 * 60 * 1000); // 16 minutes later
    expect(isLoginLocked(key).locked).toBe(false);
  });

  it('resets the counter on a successful login', () => {
    for (let i = 0; i < 4; i++) recordFailedLogin(key);
    clearLoginAttempts(key);
    // Another 4 failures right after should still not lock, since the
    // counter was reset rather than continuing from 4.
    for (let i = 0; i < 4; i++) recordFailedLogin(key);
    expect(isLoginLocked(key).locked).toBe(false);
  });

  it('starts a fresh window if the previous one expired without reaching the max', () => {
    for (let i = 0; i < 3; i++) recordFailedLogin(key);
    vi.setSystemTime(20 * 60 * 1000); // past the 15-minute window
    for (let i = 0; i < 3; i++) recordFailedLogin(key);
    // Only 3 attempts count in the new window — not enough to lock.
    expect(isLoginLocked(key).locked).toBe(false);
  });

  it('the lockout lasts 15 minutes: still locked at 14:59, free at 15:01', () => {
    for (let i = 0; i < 5; i++) recordFailedLogin(key);
    vi.setSystemTime(14 * 60 * 1000 + 59 * 1000);
    const status = isLoginLocked(key);
    expect(status.locked).toBe(true);
    expect(status.retryAfterMs).toBe(1000);
    vi.setSystemTime(15 * 60 * 1000 + 1000);
    expect(isLoginLocked(key).locked).toBe(false);
  });

  it('a new window starts when the old one ran out, even between two cleanup sweeps', () => {
    for (let i = 0; i < 3; i++) recordFailedLogin(key);
    // A sweep runs just before the window ends (via another key), so the
    // next failure on `key` lands less than a minute after it: no sweep can
    // have dropped the old record, only the window check resets the count.
    vi.setSystemTime(15 * 60 * 1000 - 1000);
    recordFailedLogin('another-key');
    vi.setSystemTime(15 * 60 * 1000 + 30 * 1000);
    for (let i = 0; i < 3; i++) recordFailedLogin(key);
    expect(isLoginLocked(key).locked).toBe(false);
    recordFailedLogin(key);
    recordFailedLogin(key);
    expect(isLoginLocked(key).locked).toBe(true);
  });

  it('the per-user key ignores username case, so changing case does not reset the count', () => {
    expect(loginUserKey('10.0.0.1', 'Alice')).toBe(loginUserKey('10.0.0.1', 'alice'));
    for (const name of ['Alice', 'ALICE', 'alice', 'aLiCe', 'alicE']) recordFailedLoginAttempt('10.0.0.1', name);
    expect(loginLockStatus('10.0.0.1', 'alice').locked).toBe(true);
    expect(loginLockStatus('10.0.0.2', 'alice').locked).toBe(false);
  });
});
