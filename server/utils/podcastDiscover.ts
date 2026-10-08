import type Database from 'better-sqlite3';
import { podcastVisibilityClause } from './podcastVisibility';
import type { SessionForVisibility } from './musicVisibility';
import type { PodcastUserSession } from './podcastFollows';
import { mergeSpellings } from './musicDiscover';

// Queries behind the Podcasts Discover page. Every list only holds shows the
// caller may see. Follower and listener figures are plain counts: no list
// ever says who follows or listens to what.

// "Trending" counts listeners whose progress moved within this window.
export const TRENDING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function visibleShowWhere(session: SessionForVisibility | null): string {
  const clause = podcastVisibilityClause(session, 's');
  return clause || '1 = 1';
}

// Optional "same language" filter (case and surrounding spaces ignored).
function languageFilter(language: string | null): { sql: string; params: string[] } {
  if (!language || !language.trim()) return { sql: '', params: [] };
  return { sql: ' AND LOWER(TRIM(s.language)) = LOWER(TRIM(?))', params: [language] };
}

// The fields of the shows index (what PodcastShowCard shows), aliases s.
const SHOW_COLUMNS = `
  s.id, s.title, s.author, s.cover_url, s.language,
  (SELECT COUNT(*) FROM podcast_episodes e WHERE e.show_id = s.id) as episode_count,
  (SELECT COUNT(*) FROM podcast_episodes e WHERE e.show_id = s.id AND e.download_status = 'completed') as completed_episode_count`;

const FOLLOWER_COUNT_SQL = '(SELECT COUNT(DISTINCT f.user_id) FROM podcast_show_follows f WHERE f.show_id = s.id)';

// Date of the newest playable episode of show s (null when it has none).
const LATEST_EPISODE_TS_SQL = `(SELECT MAX(COALESCE(e.pub_ts, e.created_at)) FROM podcast_episodes e
  WHERE e.show_id = s.id AND e.download_status = 'completed')`;

// "Popular with listeners": shows with at least one follower, most followed
// first, then the biggest catalogues.
export function listPopularShows(db: Database.Database, session: SessionForVisibility | null, limit: number, language: string | null): any[] {
  const lang = languageFilter(language);
  return db.prepare(`
    SELECT * FROM (
      SELECT ${SHOW_COLUMNS}, ${FOLLOWER_COUNT_SQL} as followerCount
      FROM podcast_shows s
      WHERE ${visibleShowWhere(session)}${lang.sql}
    )
    WHERE followerCount > 0
    ORDER BY followerCount DESC, episode_count DESC, title ASC, id ASC
    LIMIT ?
  `).all(...lang.params, Math.trunc(limit));
}

// "Recently updated": shows ordered by their newest playable episode, with
// that episode's title and date.
export function listRecentlyUpdatedShows(db: Database.Database, session: SessionForVisibility | null, limit: number, language: string | null): any[] {
  const lang = languageFilter(language);
  return db.prepare(`
    SELECT * FROM (
      SELECT ${SHOW_COLUMNS},
        ${LATEST_EPISODE_TS_SQL} as latestEpisodeAt,
        (SELECT e.title FROM podcast_episodes e WHERE e.show_id = s.id AND e.download_status = 'completed'
          ORDER BY COALESCE(e.pub_ts, e.created_at) DESC, e.id DESC LIMIT 1) as latestEpisodeTitle
      FROM podcast_shows s
      WHERE ${visibleShowWhere(session)}${lang.sql}
    )
    WHERE latestEpisodeAt IS NOT NULL
    ORDER BY latestEpisodeAt DESC, id ASC
    LIMIT ?
  `).all(...lang.params, Math.trunc(limit));
}

// "Trending episodes": playable episodes ranked by how many different users
// moved their progress on them within TRENDING_WINDOW_MS (ties: newest).
export function listTrendingEpisodes(db: Database.Database, session: SessionForVisibility | null, limit: number, now = Date.now()): any[] {
  return db.prepare(`
    SELECT e.id, e.title, e.duration, e.episode_number, e.season_number, e.pub_date,
           e.local_file_path, e.local_thumbnail_path, e.show_id, e.download_status,
           s.title as show_title, s.cover_url as show_cover_url,
           COUNT(DISTINCT p.user_id) as listenerCount
    FROM podcast_episode_progress p
    JOIN podcast_episodes e ON e.id = p.episode_id
    JOIN podcast_shows s ON s.id = e.show_id
    WHERE p.updated_at >= ? AND e.download_status = 'completed' AND ${visibleShowWhere(session)}
    GROUP BY e.id
    ORDER BY listenerCount DESC, COALESCE(e.pub_ts, e.created_at) DESC, e.id DESC
    LIMIT ?
  `).all(now - TRENDING_WINDOW_MS, Math.trunc(limit));
}

// "Because you follow <show>": shows in the languages of the user's followed
// shows that the user does not follow yet, most followed first, then the most
// recently updated. `basedOn` is the most recently followed show.
export function listBecauseYouFollow(
  db: Database.Database,
  session: PodcastUserSession,
  limit: number
): { basedOn: { id: string; title: string } | null; shows: any[] } {
  const followed = db.prepare(`
    SELECT s.id, s.title, s.language
    FROM podcast_show_follows f
    JOIN podcast_shows s ON s.id = f.show_id
    WHERE f.user_id = ? AND ${visibleShowWhere(session)}
    ORDER BY f.created_at DESC, f.rowid DESC
  `).all(session.id) as Array<{ id: string; title: string; language: string | null }>;
  if (followed.length === 0) return { basedOn: null, shows: [] };
  const basedOn = { id: followed[0]!.id, title: followed[0]!.title };

  const languages = [...new Set(followed.map((s) => (s.language ?? '').trim().toLowerCase()).filter(Boolean))];
  if (languages.length === 0) return { basedOn, shows: [] };
  const shows = db.prepare(`
    SELECT ${SHOW_COLUMNS}, ${FOLLOWER_COUNT_SQL} as followerCount
    FROM podcast_shows s
    WHERE ${visibleShowWhere(session)}
      AND LOWER(TRIM(s.language)) IN (${languages.map(() => '?').join(',')})
      AND s.id NOT IN (SELECT show_id FROM podcast_show_follows WHERE user_id = ?)
    ORDER BY followerCount DESC, COALESCE(${LATEST_EPISODE_TS_SQL}, s.created_at) DESC, s.id ASC
    LIMIT ?
  `).all(...languages, session.id, Math.trunc(limit));
  return { basedOn, shows };
}

// Languages of the visible shows (case and surrounding spaces ignored, each
// labelled with its most common spelling), most shows first.
export function listShowLanguages(db: Database.Database, session: SessionForVisibility | null): Array<{ language: string; showCount: number }> {
  const rows = db.prepare(`
    SELECT LOWER(TRIM(s.language)) as key, TRIM(s.language) as spelling, COUNT(*) as cnt
    FROM podcast_shows s
    WHERE ${visibleShowWhere(session)} AND s.language IS NOT NULL AND TRIM(s.language) != ''
    GROUP BY key, spelling
    ORDER BY key, cnt DESC, spelling
  `).all() as Array<{ key: string; spelling: string; cnt: number }>;
  return mergeSpellings(rows).map(({ label, count }) => ({ language: label, showCount: count }));
}
