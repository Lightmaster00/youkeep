import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();
  
  // 1. Verify channel exists
  const channel = db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId);
  if (!channel) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  // 2. Verify user has access to this channel (public, private, or explicit access)
  const hasAccess = await canAccessChannel(channelId, event);
  if (!hasAccess) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied.' });
  }

  // 3. Insert subscription
  db.prepare(`
    INSERT INTO user_subscriptions (user_id, channel_id, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO NOTHING
  `).run(session.id, channelId, Date.now());

  return { success: true };
});
