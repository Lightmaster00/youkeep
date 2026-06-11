import { defineEventHandler } from 'h3';

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

  const channelsQuery = `
    SELECT 
      c.id, 
      c.title, 
      c.description, 
      c.avatar_url, 
      c.banner_url, 
      c.sync_status,
      c.visibility,
      c.created_at,
      COUNT(CASE WHEN v.download_status = 'completed' THEN 1 END) as completed_count,
      COUNT(v.id) as total_count
    FROM channels c
    LEFT JOIN videos v ON c.id = v.channel_id
    ${whereSql}
    GROUP BY c.id
    ORDER BY c.title ASC
  `;

  const channels = db.prepare(channelsQuery).all(...params);
  return { channels };
});
