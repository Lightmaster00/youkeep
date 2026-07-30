import { defineEventHandler } from 'h3';
import { getUserFromSession } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) {
    return { tracks: [] };
  }

  const db = getDb();
  const visClause = session.role === 'admin' ? '' : `AND a.visibility IN ('public', 'private')`;

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name,
           COUNT(h.id) as play_count
    FROM music_play_history h
    JOIN music_tracks t ON h.track_id = t.id AND t.download_status = 'completed'
    JOIN music_artists a ON t.artist_id = a.id
    WHERE h.user_id = ? ${visClause}
    GROUP BY t.id
    ORDER BY play_count DESC
    LIMIT 30
  `).all(session.id);

  return { tracks: rows };
});
