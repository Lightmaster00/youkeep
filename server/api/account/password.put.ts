import { defineEventHandler, readBody, createError } from 'h3';
import { requireUser, hashPassword } from '../../utils/auth';
import { getDb } from '../../utils/db';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const body = await readBody(event);
  const { password } = body;

  if (!password || password.trim().length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Password cannot be empty.' });
  }

  const db = getDb();
  const passwordHash = hashPassword(password);
  
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, userSession.id);

  return { success: true };
});
