import { defineEventHandler, createError } from 'h3';
import { channelColumnsSql, videoVisibilitySql } from '../../utils/videoAccess';
import { effectiveCategoriesSql, parseCategories } from '../../utils/channelCategories';

export default defineEventHandler(async (event) => {
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();
  const session = await getUserFromSession(event);

  // Explicit columns: server paths, import errors and download options are admin-only.
  // Effective categories for everyone; the automatic list and the override
  // (for the category editor) only for admins.
  const row = db.prepare(`
    SELECT ${channelColumnsSql(session)}, ${effectiveCategoriesSql('c')} AS categories_json,
           c.categories AS categories_auto_json, c.categories_override AS categories_override_json
    FROM channels c WHERE c.id = ?
  `).get(channelId) as any;
  let channel: any = null;
  if (row) {
    const { categories_json, categories_auto_json, categories_override_json, ...rest } = row;
    channel = {
      ...rest,
      categories: parseCategories(categories_json),
      ...(session?.role === 'admin'
        ? { categories_auto: parseCategories(categories_auto_json), categories_override: categories_override_json === null ? null : parseCategories(categories_override_json) }
        : {}),
    };
  }

  // A channel the viewer may not see answers exactly like a missing one.
  if (!channel || !(await canAccessChannel(channelId, event))) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  // Stats only count the videos this viewer may see.
  const visible = videoVisibilitySql(session);

  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_count,
      SUM(CASE WHEN download_status = 'completed' THEN 1 ELSE 0 END) as completed_count,
      SUM(CASE WHEN download_status = 'completed' AND is_short = 0 THEN 1 ELSE 0 END) as completed_videos_count,
      SUM(CASE WHEN download_status = 'completed' AND is_short = 1 THEN 1 ELSE 0 END) as completed_shorts_count,
      
      SUM(CASE WHEN download_status = 'pending' AND is_short = 0 THEN 1 ELSE 0 END) as pending_videos_count,
      SUM(CASE WHEN download_status = 'pending' AND is_short = 1 THEN 1 ELSE 0 END) as pending_shorts_count,
      
      SUM(CASE WHEN download_status = 'downloading' AND is_short = 0 THEN 1 ELSE 0 END) as downloading_videos_count,
      SUM(CASE WHEN download_status = 'downloading' AND is_short = 1 THEN 1 ELSE 0 END) as downloading_shorts_count,
      
      SUM(CASE WHEN download_status = 'failed' AND is_short = 0 THEN 1 ELSE 0 END) as failed_videos_count,
      SUM(CASE WHEN download_status = 'failed' AND is_short = 1 THEN 1 ELSE 0 END) as failed_shorts_count,

      SUM(CASE WHEN download_status = 'completed' THEN duration ELSE 0 END) as total_duration,
      SUM(CASE WHEN download_status = 'completed' THEN view_count ELSE 0 END) as total_views,
      SUM(CASE WHEN download_status = 'completed' THEN size_bytes ELSE 0 END) as total_size
    FROM videos v
    JOIN channels c ON c.id = v.channel_id
    WHERE v.channel_id = ? AND ${visible.sql}
  `).get(channelId, ...visible.params) as any;

  return { 
    channel,
    stats: {
      totalCount: stats?.total_count || 0,
      completedCount: stats?.completed_count || 0,
      completedVideosCount: stats?.completed_videos_count || 0,
      completedShortsCount: stats?.completed_shorts_count || 0,
      
      pendingVideosCount: stats?.pending_videos_count || 0,
      pendingShortsCount: stats?.pending_shorts_count || 0,
      
      downloadingVideosCount: stats?.downloading_videos_count || 0,
      downloadingShortsCount: stats?.downloading_shorts_count || 0,
      
      failedVideosCount: stats?.failed_videos_count || 0,
      failedShortsCount: stats?.failed_shorts_count || 0,

      totalDuration: stats?.total_duration || 0,
      totalViews: stats?.total_views || 0,
      totalSize: stats?.total_size || 0
    }
  };
});
