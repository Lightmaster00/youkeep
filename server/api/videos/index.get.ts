import { defineEventHandler, getQuery } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const query = getQuery(event);

  const search = query.q ? String(query.q).trim() : '';
  const channelId = query.channelId ? String(query.channelId) : '';
  const status = query.status ? String(query.status) : 'completed'; // Default to show completed videos
  
  const limit = parseInt(String(query.limit || '20'), 10);
  const page = parseInt(String(query.page || '1'), 10);
  const offset = (page - 1) * limit;

  const db = getDb();
  
  // Base query construction
  let whereClauses: string[] = [];
  const params: any[] = [];

  // Filter by status if specified (e.g. completed, pending, downloading, failed)
  if (status && status !== 'all') {
    whereClauses.push('v.download_status = ?');
    params.push(status);
  }

  // Filter by channel
  if (channelId) {
    whereClauses.push('v.channel_id = ?');
    params.push(channelId);
  }

  const excludeChannelsStr = query.excludeChannels ? String(query.excludeChannels).trim() : '';
  if (excludeChannelsStr) {
    const excludeIds = excludeChannelsStr.split(',').map(id => id.trim()).filter(Boolean);
    if (excludeIds.length > 0) {
      const placeholders = excludeIds.map(() => '?').join(',');
      whereClauses.push(`v.channel_id NOT IN (${placeholders})`);
      params.push(...excludeIds);
    }
  }

  // Filter by user subscriptions
  const subscribed = query.subscribed === 'true';
  if (subscribed && session) {
    whereClauses.push('v.channel_id IN (SELECT channel_id FROM user_subscriptions WHERE user_id = ?)');
    params.push(session.id);
  }

  // Enforce access control based on visibility
  if (!session) {
    // Guest: only public videos from public channels
    whereClauses.push("v.visibility = 'public' AND c.visibility = 'public'");
  } else if (session.role !== 'admin') {
    // Standard User: public/private OR explicit access
    whereClauses.push(`
      (
        (v.visibility IN ('public', 'private') AND c.visibility IN ('public', 'private'))
        OR
        v.channel_id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?)
      )
    `);
    params.push(session.id);
  }

  // Exclude hidden videos for the logged-in user
  if (session) {
    whereClauses.push('v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)');
    params.push(session.id);
  }
  
  // is_short filter: default to 0 (videos only) on home feed, but allow all on channel page
  let isShortQuery = query.is_short !== undefined
    ? (query.is_short === 'all' ? null : (query.is_short === 'true' || query.is_short === '1' ? 1 : 0))
    : (channelId ? null : 0);

  if (isShortQuery !== null) {
    whereClauses.push('v.is_short = ?');
    params.push(isShortQuery);
  }

  // Search filter
  if (search) {
    try {
      // Properly quote words to avoid FTS syntax errors with hyphens or special chars
      const ftsQuery = search.split(/\s+/).filter(Boolean).map(word => `"${word.replace(/"/g, '""')}"*`).join(' AND ');
      if (ftsQuery) {
        // Test query to trigger catch block if FTS is missing or query is invalid
        db.prepare('SELECT 1 FROM videos_fts WHERE videos_fts MATCH ? LIMIT 1').get(ftsQuery);
        whereClauses.push('v.id IN (SELECT id FROM videos_fts WHERE videos_fts MATCH ?)');
        params.push(ftsQuery);
      }
    } catch (e) {
      // Safe fallback to basic LIKE search
      whereClauses.push('(v.title LIKE ? OR v.description LIKE ? OR c.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as count 
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    ${whereSql}
  `;
  const totalCount = (db.prepare(countQuery).get(...params) as { count: number }).count;

  // Sorting logic: use a basic recommendation algorithm for the homepage feed
  let orderBySql = 'ORDER BY v.upload_date DESC, v.created_at DESC';
  if (!search && !channelId && !subscribed) {
    const sessionUserId = session ? session.id : null;
    const historyPenaltySql = sessionUserId ? `CASE WHEN v.id IN (SELECT video_id FROM user_history WHERE user_id = ?) THEN -200 ELSE 0 END` : '0';
    const subBoostSql = sessionUserId ? `CASE WHEN v.channel_id IN (SELECT channel_id FROM user_subscriptions WHERE user_id = ?) THEN 30 ELSE 0 END` : '0';
    
    if (sessionUserId) {
      params.push(sessionUserId, sessionUserId);
    }

    orderBySql = `
      ORDER BY (
        -- Engagement (Views + Likes) -> Cap at 50 pts to prevent mega-channels from completely dominating
        MIN(COALESCE(v.view_count, 0) / 100000.0, 50) + MIN(COALESCE(v.like_count, 0) / 10000.0, 50)
        
        -- Recency (Upload date) -> 1pt per day (Using precise julianday conversion)
        + COALESCE(julianday(substr(v.upload_date, 1, 4) || '-' || substr(v.upload_date, 5, 2) || '-' || substr(v.upload_date, 7, 2)), 0)
        
        -- Archive Recency (Days since added) -> 1pt per day
        + (v.created_at / 86400000.0)
        
        -- Subscription Boost -> 30pts (equivalent to 1 month of freshness)
        + ${subBoostSql}
        
        -- Watched Video Penalty -> -200pts
        + ${historyPenaltySql}
        
        -- Serendipity (Random factor 0-15)
        + ((ABS(RANDOM()) % 150) / 10.0)
      ) DESC
    `;
  }

  // Get videos list
  const listQuery = `
    SELECT 
      v.id, 
      v.title, 
      v.description, 
      v.channel_id, 
      v.upload_date, 
      v.duration, 
      v.view_count, 
      v.local_video_path, 
      v.local_thumbnail_path, 
      v.download_status, 
      v.download_progress,
      v.download_speed,
      v.download_eta,
      v.visibility,
      v.share_token,
      v.is_short,
      v.created_at,
      c.title as channel_title,
      c.avatar_url as channel_avatar
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    ${whereSql}
    ${orderBySql}
    LIMIT ? OFFSET ?
  `;

  const videos = db.prepare(listQuery).all(...params, limit, offset);

  return {
    videos,
    pagination: {
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit)
    }
  };
});
