import { defineEventHandler, getQuery } from 'h3';
import { videoVisibilitySql } from '../../utils/videoAccess';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const search = query.search ? String(query.search).trim() : null;
  const subscribed = query.subscribed === 'true';

  const params: any[] = [];
  let baseWhereClauses = [];
  
  if (subscribed && session) {
    baseWhereClauses.push('c.id IN (SELECT channel_id FROM user_subscriptions WHERE user_id = ?)');
    params.push(session.id);
  }

  if (session && session.role === 'admin') {
    // Admins see everything
  } else if (session) {
    baseWhereClauses.push(`(c.visibility IN ('public', 'private') OR c.id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?))`);
    params.push(session.id);
  } else {
    baseWhereClauses.push(`c.visibility = 'public'`);
  }

  if (search) {
    baseWhereClauses.push(`(c.title LIKE ? OR c.description LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereSql = baseWhereClauses.length > 0 ? `WHERE ${baseWhereClauses.join(' AND ')}` : '';

  // The counts only cover the videos this viewer may see. They are computed
  // in one grouped pass over the videos (covered by the channel/visibility/
  // status index) and joined once, instead of joining every channel to its
  // videos row by row.
  const visible = videoVisibilitySql(session, 'v', 'vc');
  const channelsQuery = `
    SELECT
      c.id,
      c.title,
      c.description,
      c.avatar_url,
      c.banner_url,
      c.sync_status,
      c.visibility,
      c.import_status,
      ${session?.role === 'admin' ? 'c.import_error,' : ''}
      c.created_at,
      COALESCE(agg.completed_count, 0) as completed_count,
      COALESCE(agg.total_count, 0) as total_count
    FROM channels c
    LEFT JOIN (
      SELECT v.channel_id,
             SUM(CASE WHEN v.download_status = 'completed' THEN 1 ELSE 0 END) as completed_count,
             COUNT(*) as total_count
      FROM videos v
      JOIN channels vc ON vc.id = v.channel_id
      WHERE ${visible.sql}
      GROUP BY v.channel_id
    ) agg ON agg.channel_id = c.id
    ${whereSql}
    ORDER BY c.title ASC
  `;

  const channels = db.prepare(channelsQuery).all(...visible.params, ...params);
  return { channels };
});
