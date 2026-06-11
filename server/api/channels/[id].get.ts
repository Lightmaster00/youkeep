import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();

  const channel = db.prepare(`
    SELECT * FROM channels WHERE id = ?
  `).get(channelId);

  if (!channel) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  // Vérifier les droits d'accès
  const hasAccess = await canAccessChannel(channelId, event);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this channel.'
    });
  }

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
    FROM videos
    WHERE channel_id = ?
  `).get(channelId) as any;

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
