import type Database from 'better-sqlite3';
import { MUSIC_TRACK_COLUMNS, MUSIC_TRACK_JOINS } from './musicTrackRows';
import { visibleTrackCondition } from './musicFavorites';
import type { FavoritesSession } from './musicFavorites';

// Per-user listening history of Music, read from the play log
// (music_play_history). Strictly private: every read and delete is scoped to
// the caller's user id. Reads only return tracks the caller may currently
// see; plays of hidden tracks keep their rows.

// One row per track: its latest play and how many times it was played.
const PER_TRACK = `
  SELECT track_id, MAX(played_at) as played_at, COUNT(*) as play_count
  FROM music_play_history
  WHERE user_id = ?
  GROUP BY track_id`;

export function listMusicHistory(
  db: Database.Database,
  session: FavoritesSession,
  limit: number,
  offset: number
): { items: any[]; total: number } {
  const where = visibleTrackCondition(session);
  const items = db.prepare(`
    SELECT ${MUSIC_TRACK_COLUMNS}, h.played_at as playedAt, h.play_count as playCount
    FROM (${PER_TRACK}) h
    JOIN music_tracks t ON t.id = h.track_id
    ${MUSIC_TRACK_JOINS}
    WHERE ${where}
    ORDER BY h.played_at DESC, t.id DESC
    LIMIT ? OFFSET ?
  `).all(session.id, Math.trunc(limit), Math.trunc(offset));
  const total = (db.prepare(`
    SELECT COUNT(*) as cnt
    FROM (${PER_TRACK}) h
    JOIN music_tracks t ON t.id = h.track_id
    JOIN music_artists a ON t.artist_id = a.id
    WHERE ${where}
  `).get(session.id) as { cnt: number }).cnt;
  return { items, total };
}

// Every play of one track by this user. Works even if the track has since
// become hidden, so a user can always clean up their own history.
export function removeTrackFromHistory(db: Database.Database, userId: string, trackId: string): number {
  return db.prepare('DELETE FROM music_play_history WHERE user_id = ? AND track_id = ?').run(userId, trackId).changes;
}

export function clearMusicHistory(db: Database.Database, userId: string): number {
  return db.prepare('DELETE FROM music_play_history WHERE user_id = ?').run(userId).changes;
}
