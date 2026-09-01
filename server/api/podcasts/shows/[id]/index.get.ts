import { defineEventHandler, createError } from 'h3';
import { canAccessPodcastShow } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  const showId = event.context.params?.id;

  if (!showId) {
    throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
  }

  const db = getDb();

  const show = db.prepare(`
    SELECT id, title, description, author, cover_url, language, visibility
    FROM podcast_shows
    WHERE id = ?
  `).get(showId);

  if (!show) {
    throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
  }

  const hasAccess = await canAccessPodcastShow(showId, event);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this show.'
    });
  }

  return { show };
});
