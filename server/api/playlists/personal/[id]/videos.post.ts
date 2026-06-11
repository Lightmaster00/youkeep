import { defineEventHandler, createError, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const id = event.context.params?.id;
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Playlist ID is required.'
    });
  }

  const db = getDb();
  const playlist = db.prepare('SELECT user_id FROM personal_playlists WHERE id = ?').get(id) as { user_id: string } | undefined;

  if (!playlist) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Playlist not found.'
    });
  }

  if (playlist.user_id !== user.id && user.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to edit this playlist.'
    });
  }

  const body = await readBody(event);
  const { action, videoId } = body;

  if (!action || !['add', 'remove'].includes(action) || !videoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'action ("add" or "remove") and videoId are required.'
    });
  }

  // Verify video exists
  const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(videoId);
  if (!video) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Video not found.'
    });
  }

  if (action === 'add') {
    // Check if already in playlist
    const existing = db.prepare('SELECT position FROM personal_playlist_videos WHERE playlist_id = ? AND video_id = ?').get(id, videoId);
    if (existing) {
      return { success: true, message: 'Video already in playlist.' };
    }

    // Get max position
    const maxPosRow = db.prepare('SELECT COALESCE(MAX(position), -1) as max_pos FROM personal_playlist_videos WHERE playlist_id = ?').get(id) as { max_pos: number };
    const nextPos = maxPosRow.max_pos + 1;

    db.prepare('INSERT INTO personal_playlist_videos (playlist_id, video_id, position) VALUES (?, ?, ?)')
      .run(id, videoId, nextPos);
  } else if (action === 'remove') {
    db.prepare('DELETE FROM personal_playlist_videos WHERE playlist_id = ? AND video_id = ?').run(id, videoId);

    // Re-index remaining videos to fill gaps
    const remaining = db.prepare('SELECT video_id FROM personal_playlist_videos WHERE playlist_id = ? ORDER BY position ASC').all(id) as { video_id: string }[];
    
    const updateStmt = db.prepare('UPDATE personal_playlist_videos SET position = ? WHERE playlist_id = ? AND video_id = ?');
    db.transaction(() => {
      remaining.forEach((item, index) => {
        updateStmt.run(index, id, item.video_id);
      });
    })();
  }

  return { success: true };
});
