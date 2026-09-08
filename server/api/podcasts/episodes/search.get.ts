import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { podcastVisibilityClause } from '../../../utils/podcastVisibility';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const search = query.q ? String(query.q).trim() : '';

  const whereClauses: string[] = ["e.download_status = 'completed'"];
  const params: any[] = [];

  const visClause = podcastVisibilityClause(session, 's');
  if (visClause) {
    whereClauses.push(visClause);
  }

  if (search) {
    try {
      const ftsQuery = search.split(/\s+/).filter(Boolean).map(word => `"${word.replace(/"/g, '""')}"*`).join(' AND ');
      if (ftsQuery) {
        db.prepare('SELECT 1 FROM podcast_episodes_fts WHERE podcast_episodes_fts MATCH ? LIMIT 1').get(ftsQuery);
        whereClauses.push('e.id IN (SELECT id FROM podcast_episodes_fts WHERE podcast_episodes_fts MATCH ?)');
        params.push(ftsQuery);
      }
    } catch (e) {
      whereClauses.push('(e.title LIKE ? OR e.description LIKE ? OR s.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const episodes = db.prepare(`
    SELECT e.id, e.title, e.duration, e.episode_number, e.season_number, e.pub_date,
           e.local_file_path, e.local_thumbnail_path, e.show_id,
           s.title as show_title, s.cover_url as show_cover_url
    FROM podcast_episodes e
    JOIN podcast_shows s ON e.show_id = s.id
    ${whereSql}
    ORDER BY e.title ASC
    LIMIT 200
  `).all(...params);

  return { episodes };
});
