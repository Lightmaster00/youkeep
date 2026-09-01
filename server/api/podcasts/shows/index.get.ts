import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { podcastVisibilityClause } from '../../../utils/podcastVisibility';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const search = query.search ? String(query.search).trim() : null;

  const clauses: string[] = [];
  const params: any[] = [];

  const visClause = podcastVisibilityClause(session);
  if (visClause) {
    clauses.push(visClause);
  }

  if (search) {
    clauses.push('s.title LIKE ?');
    params.push(`%${search}%`);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  // LEFT JOIN (not music's INNER JOIN on completed tracks): a show whose
  // episodes are still downloading must stay visible in the grid, because
  // the episode list intentionally shows pending/downloading/failed rows
  // with a status badge. Both counts are returned so the UI can show the
  // total while still knowing how many are actually playable.
  const shows = db.prepare(`
    SELECT
      s.id,
      s.title,
      s.author,
      s.cover_url,
      s.visibility,
      COUNT(e.id) as episode_count,
      COUNT(CASE WHEN e.download_status = 'completed' THEN 1 END) as completed_episode_count
    FROM podcast_shows s
    LEFT JOIN podcast_episodes e ON e.show_id = s.id
    ${whereSql}
    GROUP BY s.id
    ORDER BY s.title ASC
  `).all(...params);

  return { shows };
});
