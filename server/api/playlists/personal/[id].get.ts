import { defineEventHandler, createError, getQuery } from 'h3';
import { safeEqual } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id;
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Playlist ID is required.'
    });
  }

  const db = getDb();
  const playlist = db.prepare(`
    SELECT p.id, p.title, p.description, p.user_id, p.visibility, p.share_token, p.created_at, u.username as owner_name
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

  const user = await getUserFromSession(event);
  const query = getQuery(event);
  const token = query.token;

  const isOwner = user && (playlist.user_id === user.id || user.role === 'admin');
  const hasValidToken = !!playlist.share_token && safeEqual(token, playlist.share_token);
  const isPublic = playlist.visibility === 'public';

  if (!isOwner && !isPublic && !hasValidToken) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied to this playlist.'
    });
  }

  const videos = db.prepare(`
    SELECT
      v.id,
      v.title,
      v.description,
      v.duration,
      v.view_count,
      v.download_status,
      v.download_progress,
      v.local_thumbnail_path,
      v.local_video_path,
      v.was_live,
      c.title as channel_title,
      pv.position
    FROM personal_playlist_videos pv
    JOIN videos v ON pv.video_id = v.id
    JOIN channels c ON v.channel_id = c.id
    WHERE pv.playlist_id = ?
    ORDER BY pv.position ASC
  `).all(id) as { id: string }[];

  // Only the videos this viewer may watch, the owner included: a video that
  // became hidden (or whose channel access was revoked) after it was added
  // disappears from the list. Admins see everything.
  const accessibleVideos = user?.role === 'admin'
    ? videos
    : (await Promise.all(videos.map(async (v) => (await canAccessVideo(v.id, event)) ? v : null)))
        .filter((v): v is typeof videos[number] => v !== null);

  // The share token belongs to the owner (and admins).
  if (!isOwner) delete playlist.share_token;

  return {
    playlist,
    videos: accessibleVideos
  };
});
