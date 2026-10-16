import { defineEventHandler, createError } from 'h3';
import { readOptionalJsonObject, optionalBoolean } from '../../../utils/validation';

export default defineEventHandler(async (event) => {
  const videoId = event.context.params?.id;
  const user = await requireUser(event);

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID required' });
  }

  // No body means "hide".
  const hide = optionalBoolean(await readOptionalJsonObject(event), 'hide') ?? true;
  const db = getDb();

  if (hide && (!db.prepare('SELECT 1 FROM videos WHERE id = ?').get(videoId) || !(await canAccessVideo(videoId, event)))) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }

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
    console.error('[videos/hide]', error);
    throw createError({ statusCode: 500, statusMessage: 'Could not update the hidden videos.' });
  }
});
