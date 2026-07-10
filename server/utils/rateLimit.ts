// Simple in-memory rate limiter for login attempts. Good enough for a
// single-process self-hosted deployment; not shared across multiple instances.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000;

interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}

const attempts = new Map<string, AttemptRecord>();

function cleanupStale(now: number) {
  for (const [key, record] of attempts) {
    const expired = (record.lockedUntil ?? 0) < now && (record.firstAttemptAt + WINDOW_MS) < now;
    if (expired) attempts.delete(key);
  }
}

export function isLoginLocked(key: string): { locked: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const record = attempts.get(key);
  if (record?.lockedUntil && record.lockedUntil > now) {
    return { locked: true, retryAfterMs: record.lockedUntil - now };
  }
  return { locked: false };
}

export function recordFailedLogin(key: string): void {
  const now = Date.now();
  cleanupStale(now);

  const record = attempts.get(key);
  if (!record || (now - record.firstAttemptAt) > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }

  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
  }
}

export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
}
