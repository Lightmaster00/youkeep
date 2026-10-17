import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';
import { requireAdmin } from '../../../utils/auth';
import { isValidMediaId } from '../../../utils/videoPaths';

// The share link of a video, for the admin's Share button. Share tokens stay
// admin-only (members never see them): a member can only share a video that
// is public in a public channel, whose plain /watch link works for anyone.
// The token is created on first request.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const videoId = event.context.params?.id;
  if (!videoId || !isValidMediaId(videoId)) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }

  const db = getDb();
  const video = db.prepare(`
    SELECT v.id, v.share_token, v.visibility, c.visibility AS channel_visibility
    FROM videos v JOIN channels c ON c.id = v.channel_id
    WHERE v.id = ?
  `).get(videoId) as { id: string; share_token: string | null; visibility: string | null; channel_visibility: string | null } | undefined;
  if (!video) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }

  let token = video.share_token;
  if (!token) {
    token = crypto.randomUUID();
    db.prepare('UPDATE videos SET share_token = ? WHERE id = ? AND share_token IS NULL').run(token, videoId);
    token = (db.prepare('SELECT share_token FROM videos WHERE id = ?').get(videoId) as { share_token: string }).share_token;
  }

  const isPublic = (video.visibility ?? 'public') === 'public' && (video.channel_visibility ?? 'public') === 'public';
  return {
    token,
    // A public video needs no token; a private one is only reachable with it.
    url: isPublic ? `/watch/${encodeURIComponent(videoId)}` : `/watch/${encodeURIComponent(videoId)}?token=${encodeURIComponent(token)}`,
    publiclyShareable: isPublic,
  };
});
