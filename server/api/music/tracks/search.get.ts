import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { musicVisibilityClause } from '../../../utils/musicVisibility';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const search = query.q ? String(query.q).trim() : '';

  const whereClauses: string[] = ["t.download_status = 'completed'"];
  const params: any[] = [];

  const visClause = musicVisibilityClause(session, 'a');
  if (visClause) {
    whereClauses.push(visClause);
  }

  if (search) {
    try {
      const ftsQuery = search.split(/\s+/).filter(Boolean).map(word => `"${word.replace(/"/g, '""')}"*`).join(' AND ');
      if (ftsQuery) {
        db.prepare('SELECT 1 FROM music_tracks_fts WHERE music_tracks_fts MATCH ? LIMIT 1').get(ftsQuery);
        whereClauses.push('t.id IN (SELECT id FROM music_tracks_fts WHERE music_tracks_fts MATCH ?)');
        params.push(ftsQuery);
      }
    } catch (e) {
      whereClauses.push('(t.title LIKE ? OR a.name LIKE ? OR al.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const tracks = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id,
           a.name as artist_name, al.title as album_title
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    LEFT JOIN music_albums al ON t.album_id = al.id
    ${whereSql}
    ORDER BY t.title ASC
    LIMIT 200
  `).all(...params);

  return { tracks };
});
