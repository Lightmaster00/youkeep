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

    const channelVideos = db.prepare(`
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
    `).all(id) as { id: string }[];

    // A channel's own visibility being accessible doesn't mean every video in it
    // is: a video can be individually marked private/ultra_private. Filter per-video.
    videos = (await Promise.all(channelVideos.map(async (v) => (await canAccessVideo(v.id, event)) ? v : null)))
      .filter((v): v is typeof channelVideos[number] => v !== null);
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

    const personalVideos = db.prepare(`
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
    `).all(id) as { id: string }[];

    // A public/shared playlist link must not leak videos the viewer wouldn't
    // otherwise be allowed to see (e.g. a private/ultra_private video added by the owner).
    videos = isOwner
      ? personalVideos
      : (await Promise.all(personalVideos.map(async (v) => (await canAccessVideo(v.id, event)) ? v : null)))
          .filter((v): v is typeof personalVideos[number] => v !== null);
  }

  return {
    playlist,
    videos
  };
});
