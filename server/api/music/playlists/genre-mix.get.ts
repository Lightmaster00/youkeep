import { defineEventHandler, getQuery, createError } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { musicVisibilityClause } from '../../../utils/musicVisibility';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const genre = query.genre ? String(query.genre) : null;
  if (!genre) {
    throw createError({ statusCode: 400, statusMessage: 'genre is required.' });
  }

  const session = await getUserFromSession(event);
  const db = getDb();

  const clause = musicVisibilityClause(session);
  const visClause = clause ? `AND ${clause}` : '';

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' AND t.genre = ? ${visClause}
    ORDER BY RANDOM()
    LIMIT 30
  `).all(genre);

  return { tracks: rows };
});
