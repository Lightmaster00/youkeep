import { defineEventHandler, createError, getQuery } from 'h3';
import { canAccessPodcastShow } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  const showId = event.context.params?.id;

  if (!showId) {
    throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
  }

  const db = getDb();

  const showExists = db.prepare('SELECT id FROM podcast_shows WHERE id = ?').get(showId);
  if (!showExists) {
    throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
  }

  const hasAccess = await canAccessPodcastShow(showId, event);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this show.'
    });
  }

  const query = getQuery(event);
  const limit = Math.min(200, Math.max(1, parseInt(String(query.limit ?? '50'), 10) || 50));
  const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);

  const totalRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM podcast_episodes WHERE show_id = ?
  `).get(showId) as { cnt: number };

  // Unlike music's tracks endpoint, this does NOT filter to
  // download_status = 'completed': the episode list deliberately surfaces
  // pending/downloading/failed episodes with a status badge.
  //
  // pub_date is TEXT (the raw RSS date string), so ordering on it directly
  // is unreliable across feeds — order by created_at DESC (ingestion order,
  // which follows feed order, newest first) with episode/season number as a
  // stable tiebreaker. "(x IS NULL) ASC" forces NULLs last regardless of the
  // primary column's sort direction.
  const episodes = db.prepare(`
    SELECT id, show_id, title, description, episode_number, season_number,
           duration, pub_date, download_status, local_file_path
    FROM podcast_episodes
    WHERE show_id = ?
    ORDER BY created_at DESC,
             (season_number IS NULL) ASC, season_number DESC,
             (episode_number IS NULL) ASC, episode_number DESC
    LIMIT ? OFFSET ?
  `).all(showId, limit, offset);

  return { episodes, total: totalRow.cnt };
});
