import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();
  const res = db.prepare(`
    UPDATE channels 
    SET sync_status = 'paused'
    WHERE id = ?
  `).run(channelId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  return { success: true };
});
