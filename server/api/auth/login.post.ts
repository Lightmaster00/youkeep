import { defineEventHandler, createError } from 'h3';
import { readJsonObject, normalizeUsername } from '../../utils/validation';
import { getDb } from '../../utils/db';
import { verifyPassword, createSession } from '../../utils/auth';
import { loginLockStatus, recordFailedLoginAttempt, clearLoginAttemptsFor } from '../../utils/rateLimit';
import { getClientIp, trustedProxyHops } from '../../utils/trustProxy';
import { recordSecurityEvent, isKnownLoginIp } from '../../utils/securityLog';

export default defineEventHandler(async (event) => {
  const body = await readJsonObject(event);
  const rawUsername = body.username;
  const password = body.password;

  if (typeof rawUsername !== 'string' || typeof password !== 'string' || !rawUsername || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Username and password are required.'
    });
  }
  if (rawUsername.length > 256 || password.length > 1024) {
    throw createError({ statusCode: 400, statusMessage: 'Username or password is too long.' });
  }
  // Same normalization as when the account was created (NFKC + trim).
  const username = normalizeUsername(rawUsername);

  // X-Forwarded-For is only honoured when TRUST_PROXY is set (otherwise a
  // client could pick a fresh rate-limit bucket on every attempt).
  const ip = getClientIp(event);

  // A locked-out attempt is refused even with the right password.
  const { locked, retryAfterMs } = loginLockStatus(ip, username);
  if (locked) {
    recordSecurityEvent(event, 'login_failed', { username, reason: 'rate_limited' });
    const minutes = Math.ceil((retryAfterMs || 0) / 1000 / 60);
    // Behind a reverse proxy without TRUST_PROXY every visitor shares the
    // proxy's address, so one person's failures lock everyone out.
    const proxyHint = trustedProxyHops() === 0
      ? ' If YouKeep runs behind a reverse proxy, the administrator must set TRUST_PROXY so visitors are not all counted as one.'
      : '';
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed login attempts. Try again in ${minutes} minute(s).${proxyHint}`
    });
  }

  const db = getDb();
  // Exact lookup of the normalized name; accounts created before usernames
  // were normalized may still be stored in their raw form.
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user && rawUsername !== username) {
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(rawUsername) as any;
  }

  // verifyPassword runs a full bcrypt comparison even for an unknown user, so
  // the response time does not reveal whether the username exists.
  const passwordOk = await verifyPassword(password, user?.password_hash);

  // Parallel attempts all pass the check above before any of them is
  // recorded: check again now, so a burst cannot exceed the limit. Refused
  // with the same 429 whether or not this password was the right one.
  const after = loginLockStatus(ip, username);
  if (after.locked) {
    if (!user || !passwordOk) recordFailedLoginAttempt(ip, username);
    recordSecurityEvent(event, 'login_failed', { userId: user?.id ?? null, username, reason: 'rate_limited' });
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed login attempts. Try again in ${Math.ceil((after.retryAfterMs || 0) / 1000 / 60)} minute(s).`
    });
  }

  if (!user || !passwordOk) {
    recordFailedLoginAttempt(ip, username);
    recordSecurityEvent(event, 'login_failed', { userId: user?.id ?? null, username, reason: user ? 'wrong_password' : 'unknown_user' });
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid username or password.'
    });
  }

  clearLoginAttemptsFor(ip, username);
  await createSession(user.id, event);
  if (!isKnownLoginIp(user.id, ip)) {
    recordSecurityEvent(event, 'login_new_ip', { userId: user.id, username: user.username });
  }

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.must_change_password === 1
    }
  };
});
