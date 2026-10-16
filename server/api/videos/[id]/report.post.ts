import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';
import { getDb } from '../../../utils/db';
import { requireUser, canAccessVideo } from '../../../utils/auth';
import { readJsonObject } from '../../../utils/validation';
import { consumeRateLimit } from '../../../utils/rateLimit';

const REASON_MAX_LENGTH = 500;
const REPORTS_PER_HOUR = 20;

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const videoId = event.context.params?.id;

  // Unknown and inaccessible videos get the same answer (no existence oracle).
  if (!videoId || !(await canAccessVideo(videoId, event))) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }

  const body = await readJsonObject(event);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: 'Reason required' });
  }
  if (reason.length > REASON_MAX_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `Reason must be at most ${REASON_MAX_LENGTH} characters.` });
  }

  const db = getDb();

  // One report per user and video: reporting again is a no-op.
  const existing = db.prepare('SELECT 1 FROM reports WHERE user_id = ? AND video_id = ?').get(user.id, videoId);
  if (existing) {
    return { success: true, message: 'Video reported successfully' };
  }

  if (!consumeRateLimit(`report:${user.id}`, REPORTS_PER_HOUR, 60 * 60 * 1000)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many reports. Try again later.' });
  }

  db.prepare('INSERT INTO reports (id, video_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), videoId, user.id, reason, Date.now());

  return { success: true, message: 'Video reported successfully' };
});
