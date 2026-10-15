import { defineEventHandler, createError, getRequestIP } from 'h3';
import { readJsonObject, normalizeUsername } from '../../utils/validation';
import { getDb } from '../../utils/db';
import { verifyPassword, createSession } from '../../utils/auth';
import { isLoginLocked, recordFailedLogin, clearLoginAttempts } from '../../utils/rateLimit';

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

  // Only trust X-Forwarded-For when explicitly running behind a reverse proxy
  // that overwrites/strips it; otherwise a client can set it to any value and
  // get a fresh rate-limit bucket on every attempt.
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const ip = getRequestIP(event, { xForwardedFor: trustProxy }) || 'unknown';
  const rateLimitKey = `${ip}:${username.toLowerCase()}`;

  const { locked, retryAfterMs } = isLoginLocked(rateLimitKey);
  if (locked) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed login attempts. Try again in ${Math.ceil((retryAfterMs || 0) / 1000 / 60)} minute(s).`
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
  if (!user || !passwordOk) {
    recordFailedLogin(rateLimitKey);
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid username or password.'
    });
  }

  clearLoginAttempts(rateLimitKey);
  await createSession(user.id, event);

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
