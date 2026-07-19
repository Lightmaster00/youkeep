import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  const channelId = event.context.params?.id;
  if (!channelId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel ID is required.'
    });
  }

  const hasAccess = await canAccessChannel(channelId, event);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this channel.'
    });
  }

  const db = getDb();

  const playlists = db.prepare(`
    SELECT 
      p.id, 
      p.title, 
      p.description, 
      p.thumbnail_url, 
      p.created_at,
      (SELECT COUNT(*) FROM playlist_videos pv WHERE pv.playlist_id = p.id) as video_count
    FROM playlists p
    WHERE p.channel_id = ?
    ORDER BY p.title ASC
  `).all(channelId);

  return { playlists };
});
