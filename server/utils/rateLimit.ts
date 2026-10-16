// Simple in-memory rate limiter for login attempts. Good enough for a
// single-process self-hosted deployment; not shared across multiple instances.
//
// Two limits apply to every login:
// - per ip:username: 5 failures lock that pair (stops guessing one account);
// - per ip: 30 failures across any usernames lock the address (stops
//   spraying one password over many usernames).
export const MAX_ATTEMPTS = 5;
export const MAX_ATTEMPTS_PER_IP = 30;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000;
// Bounded memory: past this many tracked keys the oldest ones are dropped.
export const MAX_TRACKED_KEYS = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}

// A Map iterates in insertion order, so its first key is the oldest one.
const attempts = new Map<string, AttemptRecord>();
let lastCleanupAt = 0;

function isExpired(record: AttemptRecord, now: number): boolean {
  return (record.lockedUntil ?? 0) < now && (record.firstAttemptAt + WINDOW_MS) < now;
}

// Full sweeps run at most once a minute; between sweeps the size cap keeps
// the map bounded.
function cleanupStale(now: number) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, record] of attempts) {
    if (isExpired(record, now)) attempts.delete(key);
  }
}

function evictOldest() {
  while (attempts.size >= MAX_TRACKED_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) return;
    attempts.delete(oldest);
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

export function recordFailedLogin(key: string, maxAttempts = MAX_ATTEMPTS): void {
  const now = Date.now();
  cleanupStale(now);

  const record = attempts.get(key);
  if (!record || (now - record.firstAttemptAt) > WINDOW_MS) {
    if (record) attempts.delete(key);
    evictOldest();
    const fresh: AttemptRecord = { count: 1, firstAttemptAt: now };
    if (maxAttempts <= 1) fresh.lockedUntil = now + LOCKOUT_MS;
    attempts.set(key, fresh);
    return;
  }

  record.count += 1;
  if (record.count >= maxAttempts) {
    record.lockedUntil = now + LOCKOUT_MS;
  }
}

export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
}

export function trackedLoginKeys(): number {
  return attempts.size;
}

/** Forgets every recorded attempt (tests only). */
export function resetAllLoginAttempts(): void {
  attempts.clear();
  lastCleanupAt = 0;
}

// --- Login-specific keys -----------------------------------------------------

export function loginUserKey(ip: string, username: string): string {
  return `login:${ip}:${username.toLowerCase()}`;
}

export function loginIpKey(ip: string): string {
  return `login-ip:${ip}`;
}

/** Lock state for a login attempt: the ip:username pair or the whole address. */
export function loginLockStatus(ip: string, username: string): { locked: boolean; retryAfterMs?: number } {
  const byIp = isLoginLocked(loginIpKey(ip));
  if (byIp.locked) return byIp;
  return isLoginLocked(loginUserKey(ip, username));
}

export function recordFailedLoginAttempt(ip: string, username: string): void {
  recordFailedLogin(loginUserKey(ip, username), MAX_ATTEMPTS);
  recordFailedLogin(loginIpKey(ip), MAX_ATTEMPTS_PER_IP);
}

// A success only clears the pair: the per-address counter keeps counting so
// an attacker cannot reset it by logging into their own account in between.
export function clearLoginAttemptsFor(ip: string, username: string): void {
  clearLoginAttempts(loginUserKey(ip, username));
}

// --- Generic per-key action limiter ------------------------------------------
// Sliding window of timestamps per key, e.g. "20 video reports per user per hour".

const actionLog = new Map<string, number[]>();

/** Records one action for `key`; false (nothing recorded) when `max` per `windowMs` is already reached. */
export function consumeRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (actionLog.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    actionLog.set(key, recent);
    return false;
  }
  recent.push(now);
  actionLog.delete(key);
  if (actionLog.size >= MAX_TRACKED_KEYS) {
    const oldest = actionLog.keys().next().value;
    if (oldest !== undefined) actionLog.delete(oldest);
  }
  actionLog.set(key, recent);
  return true;
}

/** Forgets every login attempt and action (tests only). */
export function resetAllRateLimits(): void {
  resetAllLoginAttempts();
  actionLog.clear();
}
