import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const userId = event.context.params?.id;

  if (!userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User ID is required.'
    });
  }

  const db = getDb();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found.'
    });
  }

  if (user.username === 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cannot reset the main admin account password from here.'
    });
  }

  const tempPassword = crypto.randomBytes(6).toString('hex');
  const passwordHash = hashPassword(tempPassword);

  db.prepare(`
    UPDATE users 
    SET password_hash = ?, must_change_password = 1 
    WHERE id = ?
  `).run(passwordHash, userId);

  return {
    success: true,
    password: tempPassword,
    username: user.username
  };
});
