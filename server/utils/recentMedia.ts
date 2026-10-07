import type Database from 'better-sqlite3';
import { musicVisibilityClause } from './musicVisibility';
import { podcastVisibilityClause } from './podcastVisibility';
import type { SessionForVisibility } from './musicVisibility';

// Newest playable tracks and episodes across the whole library, shared by the
// home feed rows and the Music/Podcasts "Recent" pages so both apply the same
// visibility rules. `limit`/`offset` must be server-side integers.

export interface RecentPage<T> {
  items: T[];
  total: number;
}

export function queryRecentTracks(
  db: Database.Database,
  session: SessionForVisibility | null,
  limit: number,
  offset = 0
): RecentPage<any> {
  const clause = musicVisibilityClause(session, 'a');
  const where = `t.download_status = 'completed'${clause ? ` AND ${clause}` : ''}`;
  const items = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name,
           t.album_id, al.title as album_title, al.cover_url as album_cover_url
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    LEFT JOIN music_albums al ON t.album_id = al.id
    WHERE ${where}
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ? OFFSET ?
  `).all(Math.trunc(limit), Math.trunc(offset));
  const total = (db.prepare(`
    SELECT COUNT(*) as cnt FROM music_tracks t JOIN music_artists a ON t.artist_id = a.id WHERE ${where}
  `).get() as { cnt: number }).cnt;
  return { items, total };
}

// Ordered by real publish date (pub_ts, parsed from the RSS pub_date), falling
// back to ingestion time when the date is missing or unparsable, so a show
// added later with a long back catalogue does not outrank newer episodes.
// id is the final tiebreak so pages never overlap or skip rows.
export function queryRecentEpisodes(
  db: Database.Database,
  session: SessionForVisibility | null,
  limit: number,
  offset = 0
): RecentPage<any> {
  const clause = podcastVisibilityClause(session, 's');
  const where = `e.download_status = 'completed'${clause ? ` AND ${clause}` : ''}`;
  const items = db.prepare(`
    SELECT e.id, e.title, e.duration, e.episode_number, e.season_number, e.pub_date,
           e.local_file_path, e.local_thumbnail_path, e.show_id,
           s.title as show_title, s.cover_url as show_cover_url
    FROM podcast_episodes e
    JOIN podcast_shows s ON e.show_id = s.id
    WHERE ${where}
    ORDER BY COALESCE(e.pub_ts, e.created_at) DESC, e.id DESC
    LIMIT ? OFFSET ?
  `).all(Math.trunc(limit), Math.trunc(offset));
  const total = (db.prepare(`
    SELECT COUNT(*) as cnt FROM podcast_episodes e JOIN podcast_shows s ON e.show_id = s.id WHERE ${where}
  `).get() as { cnt: number }).cnt;
  return { items, total };
}
