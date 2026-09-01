import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const showId = event.context.params?.id;

  if (!showId) {
    throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
  }

  const db = getDb();
  const res = db.prepare(`
    UPDATE podcast_shows
    SET sync_status = 'paused'
    WHERE id = ?
  `).run(showId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
  }

  return { success: true };
});
