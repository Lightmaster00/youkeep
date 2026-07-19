import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isLoginLocked, recordFailedLogin, clearLoginAttempts } from '../../server/utils/rateLimit';

describe('rateLimit', () => {
  const key = 'test-key';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    clearLoginAttempts(key);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not locked before any failed attempt', () => {
    expect(isLoginLocked(key).locked).toBe(false);
  });

  it('does not lock out before reaching the max attempt count', () => {
    for (let i = 0; i < 4; i++) recordFailedLogin(key);
    expect(isLoginLocked(key).locked).toBe(false);
  });

  it('locks out after the 5th failed attempt within the window', () => {
    for (let i = 0; i < 5; i++) recordFailedLogin(key);
    const status = isLoginLocked(key);
    expect(status.locked).toBe(true);
    expect(status.retryAfterMs).toBeGreaterThan(0);
  });

  it('keeps a distinct counter per key (e.g. per ip:username)', () => {
    for (let i = 0; i < 5; i++) recordFailedLogin(key);
    expect(isLoginLocked(key).locked).toBe(true);
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
});
