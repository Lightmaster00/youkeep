import { defineEventHandler, createError, getQuery } from 'h3';

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id;
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Playlist ID is required.'
    });
  }

  const db = getDb();

  // Try fetching channel playlist first
  let playlist = db.prepare(`
    SELECT p.id, p.title, p.description, p.thumbnail_url, p.channel_id, c.title as channel_title
    FROM playlists p
    JOIN channels c ON p.channel_id = c.id
    WHERE p.id = ?
  `).get(id) as any;

  let videos = [];

  if (playlist) {
    // Access control check for channel playlist
    const hasAccess = await canAccessChannel(playlist.channel_id, event);
    if (!hasAccess) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Access denied to this playlist.'
      });
    }

    videos = db.prepare(`
      SELECT 
        v.id, 
        v.title, 
        v.description,
        v.duration, 
        v.view_count, 
        v.download_status, 
        v.download_progress,
        v.local_thumbnail_path,
        pv.position
      FROM playlist_videos pv
      JOIN videos v ON pv.video_id = v.id
      WHERE pv.playlist_id = ?
      ORDER BY pv.position ASC
    `).all(id);
  } else {
    // Try fetching personal playlist
    playlist = db.prepare(`
      SELECT p.id, p.title, p.description, p.visibility, p.share_token, p.user_id, u.username as owner_name
      FROM personal_playlists p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `).get(id) as any;

    if (!playlist) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Playlist not found.'
      });
    }

    // Access control check for personal playlist
    const user = await getUserFromSession(event);
    const query = getQuery(event);
    const token = query.token;

    const isOwner = user && (playlist.user_id === user.id || user.role === 'admin');
    const hasValidToken = token && playlist.share_token === token;
    const isPublic = playlist.visibility === 'public';

    if (!isOwner && !isPublic && !hasValidToken) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Access denied to this playlist.'
      });
    }

    videos = db.prepare(`
      SELECT 
        v.id, 
        v.title, 
        v.description,
        v.duration, 
        v.view_count, 
        v.download_status, 
        v.download_progress,
        v.local_thumbnail_path,
        c.title as channel_title,
        pv.position
      FROM personal_playlist_videos pv
      JOIN videos v ON pv.video_id = v.id
      JOIN channels c ON v.channel_id = c.id
      WHERE pv.playlist_id = ?
      ORDER BY pv.position ASC
    `).all(id);
  }

  return {
    playlist,
    videos
  };
});
