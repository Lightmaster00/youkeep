import { defineEventHandler, createError, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  const videoId = event.context.params?.id;
  const user = await requireUser(event);

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID required' });
  }

  const { hide } = await readBody(event) || { hide: true };
  const db = getDb();

  try {
    if (hide) {
      db.prepare('INSERT OR IGNORE INTO user_hidden_videos (user_id, video_id, hidden_at) VALUES (?, ?, ?)')
        .run(user.id, videoId, Date.now());
    } else {
      db.prepare('DELETE FROM user_hidden_videos WHERE user_id = ? AND video_id = ?')
        .run(user.id, videoId);
    }
    return { success: true };
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: 'Internal server error' });
  }
});
