import { defineEventHandler, createError } from 'h3';
import { getDb } from '../../../utils/db';
import { requireAdmin, hashPassword } from '../../../utils/auth';
import { readJsonObject, validatePassword, optionalStringArray } from '../../../utils/validation';
import { assertNotLastAdmin, assertChannelsExist, replaceChannelAccess, CHANNEL_ACCESS_MAX } from '../../../utils/userAdmin';

export default defineEventHandler(async (event) => {
  const currentAdmin = await requireAdmin(event);
  const userId = event.context.params?.id;

  if (!userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User ID is required.'
    });
  }

  const body = await readJsonObject(event);

  const role = body.role;
  if (role !== undefined && role !== null && role !== 'admin' && role !== 'user') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid role.' });
  }
  // An empty or missing password means "leave it unchanged".
  const newPassword = body.password === undefined || body.password === null || body.password === ''
    ? null
    : validatePassword(body.password);
  // Only an explicit array replaces the grants: a password-only update keeps them.
  const channelAccess = optionalStringArray(body, 'channelAccess', { maxItems: CHANNEL_ACCESS_MAX, maxLength: 200 });

  const db = getDb();
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found.'
    });
  }

  if (userId === currentAdmin.id && role === 'user') {
    throw createError({ statusCode: 409, statusMessage: 'You cannot remove your own admin role.' });
  }
  if (channelAccess) assertChannelsExist(db, channelAccess);

  // Hashed before the (synchronous) transaction: hashing is async.
  const newPasswordHash = newPassword ? await hashPassword(newPassword) : null;

  const updateUserTransaction = db.transaction(() => {
    const current = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
    if (!current) {
      throw createError({ statusCode: 404, statusMessage: 'User not found.' });
    }

    if (role && role !== current.role) {
      if (role === 'user') assertNotLastAdmin(db, userId);
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    }

    if (newPasswordHash) {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newPasswordHash, userId);
      db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(userId);
    }

    const activeRole = role || current.role;
    if (activeRole === 'admin') {
      // Admins see everything: per-channel grants are meaningless for them.
      db.prepare('DELETE FROM user_channel_access WHERE user_id = ?').run(userId);
    } else if (channelAccess) {
      replaceChannelAccess(db, userId, channelAccess);
    }
  });

  updateUserTransaction();

  return { success: true };
});
