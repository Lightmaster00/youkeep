import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const db = getDb();
  const res = db.prepare(`
    UPDATE music_artists
    SET sync_status = 'paused'
    WHERE id = ?
  `).run(artistId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }

  return { success: true };
});
