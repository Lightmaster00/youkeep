import type Database from 'better-sqlite3';
import { createError } from 'h3';
import { podcastVisibilityClause } from './podcastVisibility';
import type { PodcastUserSession } from './podcastFollows';
import type { SessionForVisibility } from './musicVisibility';
import { CONTINUE_MIN_POSITION_SECONDS, isValidPodcastId, nextCompleted } from '../../shared/podcastProgress';
import type { EpisodeProgress, ProgressInput } from '../../shared/podcastProgress';

// Per-user playback progress of podcast episodes, so listening resumes on any
// device. Strictly private: every read is scoped to the caller's user id and
// to episodes of shows the caller may currently see.

interface ProgressRow {
  episode_id: string;
  position_seconds: number;
  duration_seconds: number | null;
  completed: number;
  updated_at: number;
}

function toProgress(row: ProgressRow): EpisodeProgress {
  return {
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    completed: row.completed === 1,
    updatedAt: row.updated_at,
  };
}

// Same columns as the Recent episodes list (queryRecentEpisodes), aliases e/s.
const EPISODE_COLUMNS = `
  e.id, e.title, e.duration, e.episode_number, e.season_number, e.pub_date,
  e.local_file_path, e.local_thumbnail_path, e.show_id,
  s.title as show_title, s.cover_url as show_cover_url`;

function visibleWhere(session: SessionForVisibility): string {
  const clause = podcastVisibilityClause(session, 's');
  return clause ? ` AND ${clause}` : '';
}

export interface VisibleEpisode {
  id: string;
  duration: number | null;
}

// 404 for a malformed, missing or hidden episode (the same answer, so hidden
// episodes are not revealed).
export function assertVisibleEpisode(db: Database.Database, session: SessionForVisibility, episodeId: unknown): VisibleEpisode {
  const row = isValidPodcastId(episodeId)
    ? db.prepare(`
        SELECT e.id, e.duration FROM podcast_episodes e JOIN podcast_shows s ON s.id = e.show_id
        WHERE e.id = ?${visibleWhere(session)}
      `).get(episodeId) as VisibleEpisode | undefined
    : undefined;
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found.' });
  }
  return row;
}

function readRow(db: Database.Database, userId: string, episodeId: string): ProgressRow | undefined {
  return db.prepare(`
    SELECT episode_id, position_seconds, duration_seconds, completed, updated_at
    FROM podcast_episode_progress WHERE user_id = ? AND episode_id = ?
  `).get(userId, episodeId) as ProgressRow | undefined;
}

function upsert(db: Database.Database, userId: string, episodeId: string, p: Omit<EpisodeProgress, 'updatedAt'>): EpisodeProgress {
  const updatedAt = Date.now();
  db.prepare(`
    INSERT INTO podcast_episode_progress (user_id, episode_id, position_seconds, duration_seconds, completed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, episode_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      completed = excluded.completed,
      updated_at = excluded.updated_at
  `).run(userId, episodeId, p.positionSeconds, p.durationSeconds, p.completed ? 1 : 0, updatedAt);
  return { ...p, updatedAt };
}

// Records a position. The duration used for the completion rule is the one
// sent, else the one stored earlier, else the episode's RSS duration.
export function saveProgress(db: Database.Database, userId: string, episode: VisibleEpisode, input: ProgressInput): EpisodeProgress {
  return db.transaction(() => {
    const previous = readRow(db, userId, episode.id);
    const durationSeconds = input.durationSeconds ?? previous?.duration_seconds ?? (episode.duration || null);
    const completed = nextCompleted(previous?.completed === 1, input, durationSeconds);
    return upsert(db, userId, episode.id, { positionSeconds: input.positionSeconds, durationSeconds, completed });
  })();
}

// Mark as played: completed, with the position at the end when it is known
// (so playing it again starts over). Unplayed: the row is removed, as if the
// episode had never been started.
export function setPlayed(db: Database.Database, userId: string, episode: VisibleEpisode, played: boolean): EpisodeProgress | null {
  if (!played) {
    db.prepare('DELETE FROM podcast_episode_progress WHERE user_id = ? AND episode_id = ?').run(userId, episode.id);
    return null;
  }
  return db.transaction(() => {
    const previous = readRow(db, userId, episode.id);
    const durationSeconds = previous?.duration_seconds ?? (episode.duration || null);
    const positionSeconds = durationSeconds ?? previous?.position_seconds ?? 0;
    return upsert(db, userId, episode.id, { positionSeconds, durationSeconds, completed: true });
  })();
}

// Progress of the visible episodes among `ids`, keyed by episode id.
export function progressForEpisodes(db: Database.Database, session: PodcastUserSession, ids: string[]): Record<string, EpisodeProgress> {
  const result: Record<string, EpisodeProgress> = {};
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT p.episode_id, p.position_seconds, p.duration_seconds, p.completed, p.updated_at
    FROM podcast_episode_progress p
    JOIN podcast_episodes e ON e.id = p.episode_id
    JOIN podcast_shows s ON s.id = e.show_id
    WHERE p.user_id = ? AND p.episode_id IN (${placeholders})${visibleWhere(session)}
  `).all(session.id, ...ids) as ProgressRow[];
  for (const row of rows) result[row.episode_id] = toProgress(row);
  return result;
}

function withProgress(rows: any[]): any[] {
  return rows.map(({ p_position, p_duration, p_completed, p_updated, ...episode }) => ({
    ...episode,
    progress: p_updated == null
      ? null
      : toProgress({ episode_id: episode.id, position_seconds: p_position, duration_seconds: p_duration, completed: p_completed, updated_at: p_updated }),
  }));
}

const PROGRESS_COLUMNS = `
  p.position_seconds as p_position, p.duration_seconds as p_duration,
  p.completed as p_completed, p.updated_at as p_updated`;

// Episodes started but not finished (past the first few seconds), most
// recently listened first. Only playable episodes of visible shows.
export function listContinueEpisodes(db: Database.Database, session: PodcastUserSession, limit: number): any[] {
  const rows = db.prepare(`
    SELECT ${EPISODE_COLUMNS}, ${PROGRESS_COLUMNS}
    FROM podcast_episode_progress p
    JOIN podcast_episodes e ON e.id = p.episode_id
    JOIN podcast_shows s ON s.id = e.show_id
    WHERE p.user_id = ? AND p.completed = 0 AND p.position_seconds > ?
      AND e.download_status = 'completed'${visibleWhere(session)}
    ORDER BY p.updated_at DESC, p.rowid DESC
    LIMIT ?
  `).all(session.id, CONTINUE_MIN_POSITION_SECONDS, Math.trunc(limit));
  return withProgress(rows);
}

// Latest completed episodes of the caller's followed (visible) shows, in the
// Recent list order, each with the caller's progress (or null).
export function listSubscribedEpisodes(
  db: Database.Database,
  session: PodcastUserSession,
  limit: number,
  offset: number
): { items: any[]; total: number } {
  const from = `
    FROM podcast_show_follows f
    JOIN podcast_shows s ON s.id = f.show_id
    JOIN podcast_episodes e ON e.show_id = s.id
    LEFT JOIN podcast_episode_progress p ON p.user_id = f.user_id AND p.episode_id = e.id
    WHERE f.user_id = ? AND e.download_status = 'completed'${visibleWhere(session)}`;
  const rows = db.prepare(`
    SELECT ${EPISODE_COLUMNS}, ${PROGRESS_COLUMNS}
    ${from}
    ORDER BY COALESCE(e.pub_ts, e.created_at) DESC, e.id DESC
    LIMIT ? OFFSET ?
  `).all(session.id, Math.trunc(limit), Math.trunc(offset));
  const total = (db.prepare(`SELECT COUNT(*) as cnt ${from}`).get(session.id) as { cnt: number }).cnt;
  return { items: withProgress(rows), total };
}
