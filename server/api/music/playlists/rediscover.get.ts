import { defineEventHandler } from 'h3';
import { getUserFromSession } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) {
    return { tracks: [] };
  }

  const db = getDb();
  const visClause = session.role === 'admin' ? '' : `AND a.visibility IN ('public', 'private')`;
  const thirtyDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 30;

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' ${visClause}
      AND t.id NOT IN (
        SELECT track_id FROM music_play_history
        WHERE user_id = ? AND played_at > ?
      )
    ORDER BY RANDOM()
    LIMIT 30
  `).all(session.id, thirtyDaysAgo);

  return { tracks: rows };
});
