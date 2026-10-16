import { defineEventHandler, createError } from 'h3';
import { videoVisibilitySql } from '../../../utils/videoAccess';

export default defineEventHandler(async (event) => {
  const channelId = event.context.params?.id;
  if (!channelId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel ID is required.'
    });
  }

  // A channel the viewer may not see answers exactly like a missing one.
  const hasAccess = await canAccessChannel(channelId, event);
  if (!hasAccess) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  const db = getDb();
  const visible = videoVisibilitySql(await getUserFromSession(event));

  const playlists = db.prepare(`
    SELECT 
      p.id, 
      p.title, 
      p.description, 
      p.thumbnail_url, 
      p.created_at,
      (SELECT COUNT(*) FROM playlist_videos pv
         JOIN videos v ON v.id = pv.video_id
         JOIN channels c ON c.id = v.channel_id
         WHERE pv.playlist_id = p.id AND ${visible.sql}) as video_count
    FROM playlists p
    WHERE p.channel_id = ?
    ORDER BY p.title ASC
  `).all(...visible.params, channelId);

  return { playlists };
});
