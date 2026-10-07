import type Database from 'better-sqlite3';
import { createError } from 'h3';
import { podcastVisibilityClause } from './podcastVisibility';
import type { SessionForVisibility } from './musicVisibility';
import { MAX_FOLLOWED_SHOWS, PODCAST_STATUS_MAX_IDS, isValidPodcastId } from '../../shared/podcastProgress';

// Followed podcast shows: a private list per user, unrelated to an admin
// adding the show to the library. Reads only ever return shows the caller may
// currently see; a follow of a show that later becomes hidden keeps its row
// and reappears if the show becomes visible again.

export interface PodcastUserSession extends SessionForVisibility {
  id: string;
}

// 404 for a malformed, missing or hidden show (the same answer, so hidden
// shows are not revealed).
export function assertVisibleShow(db: Database.Database, session: SessionForVisibility, showId: unknown): string {
  const clause = podcastVisibilityClause(session, 's');
  const row = isValidPodcastId(showId)
    ? db.prepare(`SELECT s.id FROM podcast_shows s WHERE s.id = ?${clause ? ` AND ${clause}` : ''}`).get(showId)
    : undefined;
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
  }
  return showId as string;
}

export function followShow(db: Database.Database, userId: string, showId: string): void {
  db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM podcast_show_follows WHERE user_id = ? AND show_id = ?').get(userId, showId);
    if (exists) return;
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM podcast_show_follows WHERE user_id = ?').get(userId) as { cnt: number }).cnt;
    if (count >= MAX_FOLLOWED_SHOWS) {
      throw createError({ statusCode: 400, statusMessage: `You can follow at most ${MAX_FOLLOWED_SHOWS} shows.` });
    }
    db.prepare('INSERT INTO podcast_show_follows (user_id, show_id, created_at) VALUES (?, ?, ?)').run(userId, showId, Date.now());
  })();
}

export function unfollowShow(db: Database.Database, userId: string, showId: string): void {
  db.prepare('DELETE FROM podcast_show_follows WHERE user_id = ? AND show_id = ?').run(userId, showId);
}

// The caller's followed shows, newest follow first, with the same fields as
// the shows index plus `followedAt` and `newCount`: completed episodes
// published after the follow date that the user has neither started nor
// played (no progress row).
export function listFollowedShows(db: Database.Database, session: PodcastUserSession): any[] {
  const clause = podcastVisibilityClause(session, 's');
  return db.prepare(`
    SELECT
      s.id, s.title, s.author, s.cover_url, s.visibility,
      (SELECT COUNT(*) FROM podcast_episodes e WHERE e.show_id = s.id) as episode_count,
      (SELECT COUNT(*) FROM podcast_episodes e WHERE e.show_id = s.id AND e.download_status = 'completed') as completed_episode_count,
      f.created_at as followedAt,
      (SELECT COUNT(*) FROM podcast_episodes e
        WHERE e.show_id = s.id
          AND e.download_status = 'completed'
          AND COALESCE(e.pub_ts, e.created_at) > f.created_at
          AND NOT EXISTS (
            SELECT 1 FROM podcast_episode_progress p WHERE p.user_id = f.user_id AND p.episode_id = e.id
          )) as newCount
    FROM podcast_show_follows f
    JOIN podcast_shows s ON s.id = f.show_id
    WHERE f.user_id = ?${clause ? ` AND ${clause}` : ''}
    ORDER BY f.created_at DESC, f.rowid DESC
  `).all(session.id);
}

// Which of `ids` the user follows (and can still see), in the order asked.
export function followedShowIds(db: Database.Database, session: PodcastUserSession, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const clause = podcastVisibilityClause(session, 's');
  const rows = db.prepare(`
    SELECT f.show_id
    FROM podcast_show_follows f
    JOIN podcast_shows s ON s.id = f.show_id
    WHERE f.user_id = ? AND f.show_id IN (${placeholders})${clause ? ` AND ${clause}` : ''}
  `).all(session.id, ...ids) as { show_id: string }[];
  const followed = new Set(rows.map((r) => r.show_id));
  return ids.filter((id) => followed.has(id));
}

// The `{ ids: string[] }` body of the follow and progress status batches,
// de-duplicated. 400 when malformed or longer than the batch limit.
export function parsePodcastStatusIds(body: unknown): string[] {
  const ids = body && typeof body === 'object' ? (body as any).ids : undefined;
  if (!Array.isArray(ids) || !ids.every(isValidPodcastId)) {
    throw createError({ statusCode: 400, statusMessage: 'ids must be an array of ids.' });
  }
  if (ids.length > PODCAST_STATUS_MAX_IDS) {
    throw createError({ statusCode: 400, statusMessage: `At most ${PODCAST_STATUS_MAX_IDS} ids per request.` });
  }
  return [...new Set(ids as string[])];
}
