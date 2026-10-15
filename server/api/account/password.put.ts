import { defineEventHandler, createError, getCookie } from 'h3';
import { requireUser, hashPassword, verifyPassword, createSession, SESSION_COOKIE_NAME } from '../../utils/auth';
import { getDb } from '../../utils/db';
import { readJsonObject, validatePassword } from '../../utils/validation';
import { isLoginLocked, recordFailedLogin, clearLoginAttempts } from '../../utils/rateLimit';

// Changing your own password requires the current one. For a user flagged
// must_change_password the "current" password is the temporary one an admin
// handed out, so the forced-change flow goes through the same check.
export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const body = await readJsonObject(event);

  const currentPassword = body.currentPassword;
  if (typeof currentPassword !== 'string' || currentPassword === '') {
    throw createError({ statusCode: 400, statusMessage: 'Current password is required.' });
  }
  const password = validatePassword(body.password);

  // Wrong current passwords are throttled per user, like login attempts.
  const rateLimitKey = `password-change:${userSession.id}`;
  const { locked, retryAfterMs } = isLoginLocked(rateLimitKey);
  if (locked) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed attempts. Try again in ${Math.ceil((retryAfterMs || 0) / 1000 / 60)} minute(s).`
    });
  }

  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userSession.id) as { password_hash: string } | undefined;
  if (!(await verifyPassword(currentPassword, row?.password_hash))) {
    recordFailedLogin(rateLimitKey);
    throw createError({ statusCode: 400, statusMessage: 'Current password is incorrect.' });
  }
  clearLoginAttempts(rateLimitKey);

  const passwordHash = await hashPassword(password);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, userSession.id);
    db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(userSession.id);
    // Every session of this user is signed out (a stolen cookie stops working)...
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userSession.id);
  })();

  // ...and the caller gets a fresh one, so they stay signed in here.
  if (getCookie(event, SESSION_COOKIE_NAME)) {
    await createSession(userSession.id, event);
  }

  return { success: true };
});
