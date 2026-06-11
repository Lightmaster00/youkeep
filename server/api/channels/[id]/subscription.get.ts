import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();
  
  // Query subscription
  const sub = db.prepare(`
    SELECT 1 FROM user_subscriptions 
    WHERE user_id = ? AND channel_id = ?
  `).get(session.id, channelId);

  return { subscribed: !!sub };
});
