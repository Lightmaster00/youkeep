import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const userId = event.context.params?.id;

  if (!userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User ID is required.'
    });
  }

  const body = await readBody(event);
  const { password, role, channelAccess } = body;

  const db = getDb();
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  
  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found.'
    });
  }

  // DB Transaction
  const updateUserTransaction = db.transaction(() => {
    // Update role if provided and valid
    if (role && (role === 'admin' || role === 'user')) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    }

    // Update password if a new one is provided
    if (password && password.trim().length > 0) {
      const passwordHash = hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, userId);
    }

    // If role has changed to admin or if it is admin, clear standard permissions (admins see everything)
    const activeRole = role || user.role;
    
    // Clear existing permissions first
    db.prepare('DELETE FROM user_channel_access WHERE user_id = ?').run(userId);

    // Write new channel access mappings for standard users
    if (activeRole === 'user' && Array.isArray(channelAccess)) {
      const insertChannelAccess = db.prepare(`
        INSERT INTO user_channel_access (user_id, channel_id)
        VALUES (?, ?)
      `);
      for (const channelId of channelAccess) {
        insertChannelAccess.run(userId, channelId);
      }
    }
  });

  updateUserTransaction();

  return { success: true };
});
