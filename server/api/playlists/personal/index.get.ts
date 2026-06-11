import { defineEventHandler, getQuery } from 'h3';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const query = getQuery(event);
  const checkVideoId = query.videoId ? String(query.videoId) : null;

  let playlists;
  if (checkVideoId) {
    playlists = db.prepare(`
      SELECT p.id, p.title, p.description, p.visibility, p.share_token, p.created_at, u.username as owner_name, COUNT(pv.video_id) as video_count,
             (SELECT COUNT(*) FROM personal_playlist_videos WHERE playlist_id = p.id AND video_id = ?) as contains_video,
             (SELECT v.local_thumbnail_path FROM personal_playlist_videos pv2 JOIN videos v ON pv2.video_id = v.id WHERE pv2.playlist_id = p.id ORDER BY pv2.position ASC LIMIT 1) as thumbnail_path
      FROM personal_playlists p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN personal_playlist_videos pv ON p.id = pv.playlist_id
      WHERE p.user_id = ? OR p.visibility = 'public'
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all(checkVideoId, user.id) as any[];
  } else {
    playlists = db.prepare(`
      SELECT p.id, p.title, p.description, p.visibility, p.share_token, p.created_at, u.username as owner_name, COUNT(pv.video_id) as video_count,
             (SELECT v.local_thumbnail_path FROM personal_playlist_videos pv2 JOIN videos v ON pv2.video_id = v.id WHERE pv2.playlist_id = p.id ORDER BY pv2.position ASC LIMIT 1) as thumbnail_path
      FROM personal_playlists p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN personal_playlist_videos pv ON p.id = pv.playlist_id
      WHERE p.user_id = ? OR p.visibility = 'public'
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all(user.id) as any[];
  }

  return { playlists };
});
