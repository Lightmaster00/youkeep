import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Non autorisé.' });
  }

  const body = await readBody(event);
  const { videoId, watchTimeSeconds } = body || {};

  if (!videoId || typeof watchTimeSeconds !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'Paramètres invalides.' });
  }

  const db = getDb();
  
  db.prepare(`
    INSERT INTO user_history (user_id, video_id, watch_time_seconds, watched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, video_id) DO UPDATE SET
      watch_time_seconds = watch_time_seconds + excluded.watch_time_seconds,
      watched_at = excluded.watched_at
  `).run(session.id, videoId, watchTimeSeconds, Date.now());

  return { success: true };
});
