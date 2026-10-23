import { defineEventHandler, createError, getQuery } from 'h3';
import { safeEqual } from '../../utils/auth';

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
  let isPersonalOwner = false;

  if (playlist) {
    // Access control check for channel playlist
    // A playlist of a channel the viewer may not see answers like a missing one.
    const hasAccess = await canAccessChannel(playlist.channel_id, event);
    if (!hasAccess) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Playlist not found.'
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
        v.is_short,
        v.was_live,
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

    const isOwner = !!user && (playlist.user_id === user.id || user.role === 'admin');
    isPersonalOwner = isOwner;
    const hasValidToken = !!playlist.share_token && safeEqual(token, playlist.share_token);
    const isPublic = playlist.visibility === 'public';

    if (!isOwner && !isPublic && !hasValidToken) {
      // Hidden answers exactly like missing: no existence oracle.
      throw createError({ statusCode: 404, statusMessage: 'Playlist not found.' });
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
        v.is_short,
        c.title as channel_title,
        pv.position
      FROM personal_playlist_videos pv
      JOIN videos v ON pv.video_id = v.id
      JOIN channels c ON v.channel_id = c.id
      WHERE pv.playlist_id = ?
      ORDER BY pv.position ASC
    `).all(id) as { id: string }[];

    // Only the videos this viewer may watch, the owner included (access can be
    // revoked after a video was added). Admins see everything.
    videos = user?.role === 'admin'
      ? personalVideos
      : (await Promise.all(personalVideos.map(async (v) => (await canAccessVideo(v.id, event)) ? v : null)))
          .filter((v): v is typeof personalVideos[number] => v !== null);
  }

  // The share token belongs to the owner (and admins).
  if (playlist.share_token !== undefined && !isPersonalOwner) delete playlist.share_token;

  return {
    playlist,
    videos
  };
});
