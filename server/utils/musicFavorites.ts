import type Database from 'better-sqlite3';
import { createError } from 'h3';
import { musicVisibilityClause } from './musicVisibility';
import type { SessionForVisibility } from './musicVisibility';
import { MUSIC_TRACK_COLUMNS, MUSIC_TRACK_JOINS } from './musicTrackRows';
import { isValidMediaId } from '../../shared/musicPlaylists';

// Liked songs: one private list per user. Reads only ever return tracks the
// caller may currently see; a like on a track that later becomes hidden keeps
// its row and reappears if the track becomes visible again.

export interface FavoritesSession extends SessionForVisibility {
  id: string;
}

// `WHERE` fragment for "a completed track the caller can see" (aliases t/a).
export function visibleTrackCondition(session: SessionForVisibility): string {
  const clause = musicVisibilityClause(session, 'a');
  return `t.download_status = 'completed'${clause ? ` AND ${clause}` : ''}`;
}

// 400 for a malformed id, 404 when the track does not exist or is hidden from
// the caller (the same answer, so hidden tracks are not revealed).
export function assertVisibleTrack(db: Database.Database, session: SessionForVisibility, trackId: unknown): string {
  if (!isValidMediaId(trackId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid track id.' });
  }
  const clause = musicVisibilityClause(session, 'a');
  const row = db.prepare(`
    SELECT t.id FROM music_tracks t JOIN music_artists a ON t.artist_id = a.id
    WHERE t.id = ?${clause ? ` AND ${clause}` : ''}
  `).get(trackId);
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
  }
  return trackId;
}

export function listFavoriteTracks(
  db: Database.Database,
  session: FavoritesSession,
  limit: number,
  offset: number
): { items: any[]; total: number } {
  const where = `f.user_id = ? AND ${visibleTrackCondition(session)}`;
  const items = db.prepare(`
    SELECT ${MUSIC_TRACK_COLUMNS}, f.created_at as liked_at
    FROM music_favorites f
    JOIN music_tracks t ON t.id = f.track_id
    ${MUSIC_TRACK_JOINS}
    WHERE ${where}
    ORDER BY f.created_at DESC, f.rowid DESC
    LIMIT ? OFFSET ?
  `).all(session.id, Math.trunc(limit), Math.trunc(offset));
  const total = (db.prepare(`
    SELECT COUNT(*) as cnt
    FROM music_favorites f
    JOIN music_tracks t ON t.id = f.track_id
    JOIN music_artists a ON t.artist_id = a.id
    WHERE ${where}
  `).get(session.id) as { cnt: number }).cnt;
  return { items, total };
}

export function addFavorite(db: Database.Database, userId: string, trackId: string): void {
  db.prepare('INSERT OR IGNORE INTO music_favorites (user_id, track_id, created_at) VALUES (?, ?, ?)')
    .run(userId, trackId, Date.now());
}

export function removeFavorite(db: Database.Database, userId: string, trackId: string): void {
  db.prepare('DELETE FROM music_favorites WHERE user_id = ? AND track_id = ?').run(userId, trackId);
}

// Which of `ids` the user has liked (and can still see).
export function likedTrackIds(db: Database.Database, session: FavoritesSession, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const clause = musicVisibilityClause(session, 'a');
  const rows = db.prepare(`
    SELECT f.track_id
    FROM music_favorites f
    JOIN music_tracks t ON t.id = f.track_id
    JOIN music_artists a ON t.artist_id = a.id
    WHERE f.user_id = ? AND f.track_id IN (${placeholders})${clause ? ` AND ${clause}` : ''}
  `).all(session.id, ...ids) as { track_id: string }[];
  const liked = new Set(rows.map((r) => r.track_id));
  return ids.filter((id) => liked.has(id));
}
