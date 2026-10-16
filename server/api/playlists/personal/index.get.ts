import { defineEventHandler, getQuery } from 'h3';
import { videoVisibilitySql } from '../../../utils/videoAccess';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const query = getQuery(event);
  const checkVideoId = query.videoId ? String(query.videoId) : null;

  // Counts, thumbnails and "contains" only consider the videos this viewer may
  // see: another user's public playlist must not reveal hidden videos.
  const visible = videoVisibilitySql(user);
  const visibleEntries = `
    SELECT pv.playlist_id, pv.video_id, pv.position, v.local_thumbnail_path
    FROM personal_playlist_videos pv
    JOIN videos v ON v.id = pv.video_id
    JOIN channels c ON c.id = v.channel_id
    WHERE ${visible.sql}`;

  const playlists = db.prepare(`
    WITH entries AS (${visibleEntries})
    SELECT p.id, p.title, p.description, p.visibility, p.share_token, p.user_id, p.created_at, u.username as owner_name,
           (SELECT COUNT(*) FROM entries e WHERE e.playlist_id = p.id) as video_count,
           ${checkVideoId ? '(SELECT COUNT(*) FROM entries e WHERE e.playlist_id = p.id AND e.video_id = ?) as contains_video,' : ''}
           (SELECT e.local_thumbnail_path FROM entries e WHERE e.playlist_id = p.id ORDER BY e.position ASC LIMIT 1) as thumbnail_path
    FROM personal_playlists p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ? OR p.visibility = 'public'
    ORDER BY p.created_at DESC
  `).all(...visible.params, ...(checkVideoId ? [checkVideoId] : []), user.id) as any[];

  // The share token belongs to the owner (and admins).
  for (const p of playlists) {
    if (p.user_id !== user.id && user.role !== 'admin') delete p.share_token;
    delete p.user_id;
  }
  return { playlists };
});
