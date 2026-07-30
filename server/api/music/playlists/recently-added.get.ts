import { defineEventHandler } from 'h3';
import { getUserFromSession } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  let visClause = `AND a.visibility = 'public'`;
  if (session && session.role === 'admin') {
    visClause = '';
  } else if (session) {
    visClause = `AND a.visibility IN ('public', 'private')`;
  }

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' ${visClause}
    ORDER BY t.created_at DESC
    LIMIT 30
  `).all();

  return { tracks: rows };
});
