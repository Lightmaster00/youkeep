import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';
import { canAccessMusicTrack, getUserFromSession } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  const trackId = event.context.params?.id;
  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const db = getDb();

  const track = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(trackId);
  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
  }

  const hasAccess = await canAccessMusicTrack(trackId, event);
  if (!hasAccess) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied.' });
  }

  const session = await getUserFromSession(event);
  if (!session) {
    // Guests can listen but their plays aren't recorded.
    return { recorded: false };
  }

  db.prepare(`
    INSERT INTO music_play_history (id, track_id, user_id, played_at)
    VALUES (?, ?, ?, ?)
  `).run(crypto.randomUUID(), trackId, session.id, Date.now());

  return { recorded: true };
});
