import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';
import { canAccessMusicTrack, getUserFromSession } from '../../../../utils/auth';

// A replay of the same track within this window (a double click, a resumed
// stream, a client retry) is not a new play.
const PLAY_DEDUPE_WINDOW_MS = 30_000;
// Plays recorded per user per hour, so a script cannot grow the history (and
// the cost of the queries over it) without bound.
const MAX_PLAYS_PER_HOUR = 120;

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

  const now = Date.now();
  const recent = db.prepare(`
    SELECT 1 FROM music_play_history WHERE user_id = ? AND track_id = ? AND played_at > ? LIMIT 1
  `).get(session.id, trackId, now - PLAY_DEDUPE_WINDOW_MS);
  if (recent) return { recorded: false, reason: 'duplicate' };

  const lastHour = (db.prepare(`
    SELECT COUNT(*) as n FROM music_play_history WHERE user_id = ? AND played_at > ?
  `).get(session.id, now - 3_600_000) as { n: number }).n;
  if (lastHour >= MAX_PLAYS_PER_HOUR) return { recorded: false, reason: 'rate_limited' };

  db.prepare(`
    INSERT INTO music_play_history (id, track_id, user_id, played_at)
    VALUES (?, ?, ?, ?)
  `).run(crypto.randomUUID(), trackId, session.id, now);

  return { recorded: true };
});
