import type Database from 'better-sqlite3';
import { musicVisibilityClause } from './musicVisibility';
import type { SessionForVisibility } from './musicVisibility';
import { MUSIC_TRACK_COLUMNS, MUSIC_TRACK_JOINS } from './musicTrackRows';
import { ALBUM_COVER_URL_FALLBACK_SQL } from './musicAlbumQueries';

// Queries behind the Music Discover page and the genre page. Every list only
// holds completed tracks of artists the caller may see.

export interface DiscoverUserSession extends SessionForVisibility {
  id: string;
}

export const LIKED_MIX_SIZE = 30;
// At most this many liked tracks in the mix, so there is room for related
// tracks the user has not liked yet.
export const LIKED_MIX_MAX_LIKED = 20;
export const GENRE_TILE_LIMIT = 40;
// An artist the user played at most this many times is still "to explore".
export const EXPLORE_MAX_PLAYS = 2;

// A `limit`/`offset`-style query value as a bounded integer (Discover rows of
// both Music and Podcasts).
export function discoverInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function visibleTrackWhere(session: SessionForVisibility | null): string {
  const clause = musicVisibilityClause(session, 'a');
  return `t.download_status = 'completed'${clause ? ` AND ${clause}` : ''}`;
}

// The form genres and podcast languages are grouped and matched by: trimmed,
// NFC-normalised and lower-cased with full Unicode rules (SQLite's LOWER only
// folds ASCII letters, so accented spellings would stay apart).
export function normaliseLabelKey(value: string): string {
  return value.trim().normalize('NFC').toLocaleLowerCase('en-US');
}

// Those of `rawValues` whose normalised key is one of `keys`, for a
// parameterised `IN (...)` on the raw column.
export function rawValuesForKeys(rawValues: string[], keys: Iterable<string>): string[] {
  const wanted = new Set(keys);
  return rawValues.filter((v) => wanted.has(normaliseLabelKey(v)));
}

// Every distinct non-empty genre spelling in the library (any visibility):
// only used to turn normalised keys back into raw values, so the result never
// reaches the caller.
function allGenreSpellings(db: Database.Database): string[] {
  return (db.prepare(`SELECT DISTINCT genre FROM music_tracks WHERE genre IS NOT NULL AND TRIM(genre) != ''`)
    .all() as Array<{ genre: string }>).map((r) => r.genre);
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',');
}

// A small seeded generator (mulberry32 over a string hash), so a given seed
// always produces the same mix.
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// "Mix from your liked songs": a shuffled sample of the user's liked tracks,
// topped up with tracks they have not liked by the same artists or in the same
// genres, then shuffled together. Same seed and same library, same mix.
export function buildLikedMix(db: Database.Database, session: DiscoverUserSession, seed: string): any[] {
  const where = visibleTrackWhere(session);
  const liked = db.prepare(`
    SELECT ${MUSIC_TRACK_COLUMNS}
    FROM music_favorites f
    JOIN music_tracks t ON t.id = f.track_id
    ${MUSIC_TRACK_JOINS}
    WHERE f.user_id = ? AND ${where}
    ORDER BY t.id
  `).all(session.id) as any[];
  if (liked.length === 0) return [];

  const random = seededRandom(seed);
  const likedSample = shuffleWith(liked, random);
  const picked = likedSample.slice(0, LIKED_MIX_MAX_LIKED);

  const artistIds = [...new Set(liked.map((t) => t.artist_id))];
  const genreKeys = liked.map((t) => normaliseLabelKey(t.genre ?? '')).filter(Boolean);
  const genreValues = genreKeys.length > 0 ? rawValuesForKeys(allGenreSpellings(db), genreKeys) : [];
  const related: any[] = [];
  if (artistIds.length > 0) {
    const artistMarks = placeholders(artistIds);
    const genreSql = genreValues.length > 0 ? ` OR t.genre IN (${placeholders(genreValues)})` : '';
    related.push(...db.prepare(`
      SELECT ${MUSIC_TRACK_COLUMNS}
      FROM music_tracks t
      ${MUSIC_TRACK_JOINS}
      WHERE ${where}
        AND (t.artist_id IN (${artistMarks})${genreSql})
        AND t.id NOT IN (SELECT track_id FROM music_favorites WHERE user_id = ?)
      ORDER BY t.id
    `).all(...artistIds, ...genreValues, session.id) as any[]);
  }

  const mix = [...picked, ...shuffleWith(related, random).slice(0, LIKED_MIX_SIZE - picked.length)];
  // Not enough related tracks: fill the rest with more liked ones.
  if (mix.length < LIKED_MIX_SIZE) mix.push(...likedSample.slice(picked.length, picked.length + LIKED_MIX_SIZE - mix.length));
  return shuffleWith(mix, random);
}

// Folds `(raw value, count)` rows into one entry per normalised key, labelled
// with its most common trimmed spelling (ties: alphabetical), biggest first
// (ties by label). Used for genres and podcast languages.
export function mergeSpellings(rows: Array<{ value: string; cnt: number }>): Array<{ label: string; count: number }> {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const row of rows) {
    const spelling = row.value.trim();
    if (!spelling) continue;
    const key = normaliseLabelKey(spelling);
    const group = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    group.count += row.cnt;
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + row.cnt);
    groups.set(key, group);
  }
  const byLabel = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return [...groups.values()]
    .map(({ count, spellings }) => {
      const [label] = [...spellings].sort(([a, n], [b, m]) => m - n || byLabel(a, b))[0]!;
      return { label, count };
    })
    .sort((x, y) => y.count - x.count || byLabel(x.label, y.label));
}

// Genres of the visible library, grouped without regard to case, accents'
// composition or surrounding spaces; each is labelled with its most common
// spelling.
export function listGenres(db: Database.Database, session: SessionForVisibility | null): Array<{ genre: string; trackCount: number }> {
  const rows = db.prepare(`
    SELECT t.genre as value, COUNT(*) as cnt
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE ${visibleTrackWhere(session)} AND t.genre IS NOT NULL AND TRIM(t.genre) != ''
    GROUP BY t.genre
  `).all() as Array<{ value: string; cnt: number }>;
  return mergeSpellings(rows)
    .map(({ label, count }) => ({ genre: label, trackCount: count }))
    .slice(0, GENRE_TILE_LIMIT);
}

// Tracks of one genre (same grouping as listGenres), newest first.
export function listGenreTracks(
  db: Database.Database,
  session: SessionForVisibility | null,
  genre: string,
  limit: number,
  offset: number
): { items: any[]; total: number } {
  const key = normaliseLabelKey(genre);
  const values = key ? rawValuesForKeys(allGenreSpellings(db), [key]) : [];
  if (values.length === 0) return { items: [], total: 0 };
  const where = `${visibleTrackWhere(session)} AND t.genre IN (${placeholders(values)})`;
  const items = db.prepare(`
    SELECT ${MUSIC_TRACK_COLUMNS}
    FROM music_tracks t
    ${MUSIC_TRACK_JOINS}
    WHERE ${where}
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ? OFFSET ?
  `).all(...values, Math.trunc(limit), Math.trunc(offset));
  const total = (db.prepare(`
    SELECT COUNT(*) as cnt FROM music_tracks t JOIN music_artists a ON t.artist_id = a.id WHERE ${where}
  `).get(...values) as { cnt: number }).cnt;
  return { items, total };
}

// Latest albums that have at least one playable visible track.
export function listRecentAlbums(db: Database.Database, session: SessionForVisibility | null, limit: number): any[] {
  return db.prepare(`
    SELECT al.id, al.title, al.release_year, al.artist_id, a.name as artist_name,
           ${ALBUM_COVER_URL_FALLBACK_SQL} as cover_url,
           COUNT(t.id) as trackCount
    FROM music_albums al
    JOIN music_tracks t ON t.album_id = al.id
    JOIN music_artists a ON t.artist_id = a.id
    WHERE ${visibleTrackWhere(session)}
    GROUP BY al.id
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT ?
  `).all(Math.trunc(limit));
}

// Visible artists with playable tracks that the user has played at most
// EXPLORE_MAX_PLAYS times, biggest catalogues first.
export function listArtistsToExplore(db: Database.Database, session: DiscoverUserSession, limit: number): any[] {
  return db.prepare(`
    SELECT a.id, a.name, a.avatar_url, COUNT(t.id) as track_count
    FROM music_artists a
    JOIN music_tracks t ON t.artist_id = a.id
    WHERE ${visibleTrackWhere(session)}
      AND (
        SELECT COUNT(*) FROM music_play_history h
        JOIN music_tracks ht ON ht.id = h.track_id
        WHERE h.user_id = ? AND ht.artist_id = a.id
      ) <= ?
    GROUP BY a.id
    ORDER BY track_count DESC, a.name ASC, a.id ASC
    LIMIT ?
  `).all(session.id, EXPLORE_MAX_PLAYS, Math.trunc(limit));
}
