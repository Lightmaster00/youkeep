import { defineEventHandler, readBody, createError } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { username, password, role, channelAccess } = body;

  if (!username || !role) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Username and role are required.'
    });
  }

  if (role !== 'admin' && role !== 'user') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid role.'
    });
  }

  const db = getDb();

  // Check if user already exists
  const existingUser = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (existingUser) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Username already exists.'
    });
  }

  const finalPassword = password && password.trim().length > 0 ? password : crypto.randomBytes(6).toString('hex');
  const userId = crypto.randomUUID();
  const passwordHash = hashPassword(finalPassword);

  // DB transaction to guarantee atomic updates
  const createUserTransaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, must_change_password, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(userId, username, passwordHash, role, Date.now());

    // Write channel access mappings for standard users
    if (Array.isArray(channelAccess) && role === 'user') {
      const insertChannelAccess = db.prepare(`
        INSERT INTO user_channel_access (user_id, channel_id)
        VALUES (?, ?)
      `);
      for (const channelId of channelAccess) {
        insertChannelAccess.run(userId, channelId);
      }
    }
  });

  createUserTransaction();

  return {
    success: true,
    userId,
    password: finalPassword
  };
});
