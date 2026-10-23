import { defineEventHandler, createError } from 'h3';
import { getDb } from '../../utils/db';
import { requireUser, canAccessVideo } from '../../utils/auth';
import { readJsonObject } from '../../utils/validation';

// The client reports watch time in small increments; a single call can never
// account for more than this.
const MAX_SECONDS_PER_CALL = 600;
// A resume position beyond a day is not a real one.
const MAX_POSITION_SECONDS = 86_400;

const isOptionalNumber = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);

  const body = await readJsonObject(event);
  const { videoId, watchTimeSeconds, positionSeconds, durationSeconds } = body;

  if (typeof videoId !== 'string' || videoId === '' || videoId.length > 200
    || typeof watchTimeSeconds !== 'number' || !Number.isFinite(watchTimeSeconds)
    || !isOptionalNumber(positionSeconds) || !isOptionalNumber(durationSeconds)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid parameters.' });
  }

  // Unknown and inaccessible videos get the same answer (no existence oracle).
  if (!(await canAccessVideo(videoId, event))) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }

  const seconds = Math.min(MAX_SECONDS_PER_CALL, Math.floor(watchTimeSeconds));
  const hasPosition = typeof positionSeconds === 'number';
  const position = hasPosition ? Math.min(MAX_POSITION_SECONDS, Math.max(0, Math.floor(positionSeconds))) : null;
  const duration = typeof durationSeconds === 'number' && durationSeconds > 0
    ? Math.min(MAX_POSITION_SECONDS, Math.round(durationSeconds))
    : null;
  const now = Date.now();
  const db = getDb();

  if (seconds > 0) {
    db.prepare(`
      INSERT INTO user_history (user_id, video_id, watch_time_seconds, watched_at, position_seconds, duration_seconds, position_updated_at)
      VALUES (?, ?, ?, ?, COALESCE(?, 0), ?, ?)
      ON CONFLICT(user_id, video_id) DO UPDATE SET
        watch_time_seconds = watch_time_seconds + excluded.watch_time_seconds,
        watched_at = excluded.watched_at,
        position_seconds = CASE WHEN ? THEN excluded.position_seconds ELSE position_seconds END,
        duration_seconds = COALESCE(excluded.duration_seconds, duration_seconds),
        position_updated_at = CASE WHEN ? THEN excluded.position_updated_at ELSE position_updated_at END
    `).run(session.id, videoId, seconds, now, position, duration, hasPosition ? now : null, hasPosition ? 1 : 0, hasPosition ? 1 : 0);
  } else if (hasPosition) {
    // A seek or pause without new playback: moves an existing row only (a
    // history row is created by actual watching, or by opening the video).
    db.prepare(`
      UPDATE user_history
      SET position_seconds = ?, duration_seconds = COALESCE(?, duration_seconds), position_updated_at = ?
      WHERE user_id = ? AND video_id = ?
    `).run(position, duration, now, session.id, videoId);
  }

  return { success: true };
});
