import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';
import { getDb } from '../../../../utils/db';
import { requireAdmin, hashPassword } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  const currentAdmin = await requireAdmin(event);
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

  // An admin changes their own password from the account page (which asks
  // for the current one), not by issuing themselves a temporary password.
  if (userId === currentAdmin.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Change your own password from your account page.'
    });
  }

  const tempPassword = crypto.randomBytes(6).toString('hex');
  const passwordHash = await hashPassword(tempPassword);

  db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = 1
      WHERE id = ?
    `).run(passwordHash, userId);
    db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(userId);
    // Sign the user out everywhere: they log in again with the temporary password.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  })();

  return {
    success: true,
    password: tempPassword,
    username: user.username
  };
});
