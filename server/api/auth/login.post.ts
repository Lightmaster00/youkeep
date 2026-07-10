import { defineEventHandler, readBody, createError, getRequestIP } from 'h3';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { username, password } = body;

  if (!username || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Username and password are required.'
    });
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown';
  const rateLimitKey = `${ip}:${String(username).toLowerCase()}`;

  const { locked, retryAfterMs } = isLoginLocked(rateLimitKey);
  if (locked) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed login attempts. Try again in ${Math.ceil((retryAfterMs || 0) / 1000 / 60)} minute(s).`
    });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

  if (!user || !verifyPassword(password, user.password_hash)) {
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
