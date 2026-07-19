import { defineEventHandler, readBody, createError } from 'h3';
import { requireUser, hashPassword } from '../../utils/auth';
import { getDb } from '../../utils/db';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const body = await readBody(event);
  const { password } = body;

  if (!password || password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters long.' });
  }

  const db = getDb();
  const passwordHash = hashPassword(password);
  
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, userSession.id);

  return { success: true };
});
