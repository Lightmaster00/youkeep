import { defineEventHandler, createError } from 'h3';
import { getDb } from '../../utils/db';
import { requireUser, canAccessVideo } from '../../utils/auth';
import { readJsonObject } from '../../utils/validation';

// The client reports watch time in small increments; a single call can never
// account for more than this.
const MAX_SECONDS_PER_CALL = 600;

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);

  const body = await readJsonObject(event);
  const { videoId, watchTimeSeconds } = body;

  if (typeof videoId !== 'string' || videoId === '' || videoId.length > 200
    || typeof watchTimeSeconds !== 'number' || !Number.isFinite(watchTimeSeconds)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid parameters.' });
  }

  // Unknown and inaccessible videos get the same answer (no existence oracle).
  if (!(await canAccessVideo(videoId, event))) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }

  const seconds = Math.min(MAX_SECONDS_PER_CALL, Math.floor(watchTimeSeconds));
  if (!(seconds > 0)) {
    return { success: true };
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO user_history (user_id, video_id, watch_time_seconds, watched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, video_id) DO UPDATE SET
      watch_time_seconds = watch_time_seconds + excluded.watch_time_seconds,
      watched_at = excluded.watched_at
  `).run(session.id, videoId, seconds, Date.now());

  return { success: true };
});
