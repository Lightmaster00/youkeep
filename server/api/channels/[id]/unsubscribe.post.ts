import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();

  // Remove subscription
  db.prepare(`
    DELETE FROM user_subscriptions 
    WHERE user_id = ? AND channel_id = ?
  `).run(session.id, channelId);

  return { success: true };
});
