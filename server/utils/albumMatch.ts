import crypto from 'crypto';
import type Database from 'better-sqlite3';

/**
 * Album matching: finds the real album of a downloaded track through Apple's
 * public iTunes Search API. This file holds the pure helpers (title cleaning,
 * candidate selection), the HTTP call (always injectable) and the database
 * transaction that applies a match. The background queue lives in
 * albumMatchRunner.ts; nothing here ever runs inside a request.
 */

export type AlbumType = 'album' | 'single' | 'ep';

export interface ItunesMatch {
  collectionId: string;
  collectionName: string;
  albumType: AlbumType;
  artworkUrl: string | null;
  releaseYear: number | null;
  trackNumber: number | null;
  genre: string | null;
}

export const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
export const ITUNES_TIMEOUT_MS = 8_000;
export const ITUNES_RESULT_LIMIT = 8;
export const TITLE_SIMILARITY_THRESHOLD = 0.9;

/** Case-, diacritics- and punctuation-insensitive comparison key. */
export function normaliseKey(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Bracketed groups that only describe the upload, never the song itself.
const NOISE_GROUP = /\s*[(\[](?:[^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv)\b[^)\]]*)[)\]]/giu;
const FEAT_TAIL = /\s*[(\[]?\s*\b(?:feat\.?|ft\.?|featuring)(?=\s|$)[\s\S]*$/iu;
const PIPE_TAIL = /\s*\|[\s\S]*$/u;
const DASH_SEPARATOR = /\s+[-–—]\s+/u;

/**
 * Strips what YouTube uploads add around a song title: "(Official Video)",
 * "[HD]", "[Lyrics]", "| Official ..." and "feat. ..." tails, and an
 * "Artist - " prefix. The result is NFC-normalised with single spaces.
 */
export function cleanTrackTitle(title: string, artistName: string): string {
  let result = String(title ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

  // "Artist - Title" (also "Artist & Someone - Title").
  const dash = result.match(DASH_SEPARATOR);
  if (dash && dash.index !== undefined && dash.index > 0) {
    const head = normaliseKey(result.slice(0, dash.index));
    const artistKey = normaliseKey(artistName);
    if (artistKey && head && (head === artistKey || head.includes(artistKey))) {
      result = result.slice(dash.index + dash[0].length);
    }
  }

  result = result.replace(PIPE_TAIL, '');
  result = result.replace(NOISE_GROUP, '');
  result = result.replace(FEAT_TAIL, '');
  result = result.replace(NOISE_GROUP, '');
  result = result.replace(/\s+/g, ' ').replace(/[\s\-–—]+$/u, '').trim();
  // Never clean a title down to nothing.
  return result || String(title ?? '').normalize('NFC').trim();
}

/** Levenshtein distance between two strings (by UTF-16 unit; keys are plain). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Normalised similarity in [0, 1] of two comparison keys. */
export function keySimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/** Removes a trailing " - Single" / " - EP" from an iTunes collection name and derives the type. */
export function parseCollectionName(name: string): { title: string; type: AlbumType } {
  const raw = String(name ?? '').trim();
  const match = raw.match(/\s+-\s+(single|ep)$/i);
  if (!match || match.index === undefined) return { title: raw, type: 'album' };
  return { title: raw.slice(0, match.index).trim(), type: match[1]!.toLowerCase() === 'ep' ? 'ep' : 'single' };
}

/** iTunes artwork comes as 100x100; the same URL serves 600x600. */
export function largeArtworkUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  return url.replace('100x100bb', '600x600bb');
}

function artistMatches(candidateArtist: string, trackArtistKey: string): boolean {
  const candidateKey = normaliseKey(candidateArtist);
  if (!candidateKey || !trackArtistKey) return false;
  return candidateKey === trackArtistKey || candidateKey.includes(trackArtistKey) || trackArtistKey.includes(candidateKey);
}

function releaseTime(raw: any): number {
  const t = Date.parse(raw?.releaseDate ?? '');
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Picks the best iTunes song result for a track, or null. The artist must be
 * equal to, contain or be contained in the track's artist; the cleaned title
 * must have the same key (or, when no result does, a similarity of at least
 * 0.9). Among accepted results: albums before singles/EPs, then the earliest
 * release.
 */
export function pickBestCandidate(results: any[], artistName: string, cleanedTitle: string): any | null {
  const artistKey = normaliseKey(artistName);
  const titleKey = normaliseKey(cleanedTitle);
  if (!artistKey || !titleKey || !Array.isArray(results)) return null;

  const exact: any[] = [];
  const close: any[] = [];
  for (const raw of results) {
    if (!raw || (raw.wrapperType && raw.wrapperType !== 'track') || (raw.kind && raw.kind !== 'song')) continue;
    if (raw.collectionId === undefined || raw.collectionId === null || !raw.collectionName) continue;
    if (!artistMatches(raw.artistName, artistKey)) continue;
    const candidateKey = normaliseKey(cleanTrackTitle(String(raw.trackName ?? ''), String(raw.artistName ?? '')));
    if (!candidateKey) continue;
    if (candidateKey === titleKey) exact.push(raw);
    else if (keySimilarity(candidateKey, titleKey) >= TITLE_SIMILARITY_THRESHOLD) close.push(raw);
  }

  const pool = exact.length ? exact : close;
  if (!pool.length) return null;
  const rank = (raw: any) => (parseCollectionName(raw.collectionName).type === 'album' ? 0 : 1);
  return [...pool].sort((a, b) => rank(a) - rank(b) || releaseTime(a) - releaseTime(b))[0];
}

/** Maps an iTunes song result to what the database stores. */
export function toItunesMatch(raw: any): ItunesMatch {
  const { title, type } = parseCollectionName(raw.collectionName);
  const year = Number.parseInt(String(raw.releaseDate ?? '').slice(0, 4), 10);
  const trackNumber = Number(raw.trackNumber);
  const genre = typeof raw.primaryGenreName === 'string' && raw.primaryGenreName.trim() ? raw.primaryGenreName.trim() : null;
  return {
    collectionId: String(raw.collectionId),
    collectionName: title,
    albumType: type,
    artworkUrl: largeArtworkUrl(raw.artworkUrl100),
    releaseYear: Number.isInteger(year) && year > 1800 ? year : null,
    trackNumber: Number.isInteger(trackNumber) && trackNumber > 0 ? trackNumber : null,
    genre,
  };
}

/** Runs one iTunes search and returns its raw results. Throws on HTTP or network errors. */
export type ItunesFetcher = (term: string) => Promise<any[]>;

export const defaultItunesFetcher: ItunesFetcher = async (term) => {
  const data = await (globalThis as any).$fetch(ITUNES_SEARCH_URL, {
    params: { term, entity: 'song', media: 'music', limit: ITUNES_RESULT_LIMIT, country: 'US', lang: 'en_us' },
    // iTunes answers with a text/javascript content type; an error page is not JSON.
    parseResponse: (text: string) => { try { return JSON.parse(text); } catch { return null; } },
    timeout: ITUNES_TIMEOUT_MS,
    retry: 0,
  });
  return Array.isArray(data?.results) ? data.results : [];
};

/** Searches iTunes for one track; null when no result is a match. */
export async function searchItunesSong(artistName: string, title: string, fetcher: ItunesFetcher = defaultItunesFetcher): Promise<ItunesMatch | null> {
  const cleaned = cleanTrackTitle(title, artistName);
  const results = await fetcher(`${artistName} ${cleaned}`);
  const best = pickBestCandidate(results, artistName, cleaned);
  return best ? toItunesMatch(best) : null;
}

/** HTTP status of a failed request, when it has one. */
export function errorStatus(err: any): number | null {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  return typeof status === 'number' ? status : null;
}

/** 429, 5xx, timeouts and network failures: worth waiting and trying again later. */
export function isTransientMatchError(err: any): boolean {
  const status = errorStatus(err);
  if (status === null) return true;
  return status === 429 || status >= 500;
}

/** Exponential backoff after `failures` consecutive transient errors (30 s, 60 s, 120 s ... at most 15 min). */
export function backoffDelayMs(failures: number, baseMs = 30_000, maxMs = 15 * 60_000): number {
  const exponent = Math.max(0, failures - 1);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

/**
 * Spaces requests out: `wait()` resolves no sooner than `intervalMs` after
 * the previous `wait()` resolved. One instance is shared process-wide.
 */
export class RequestThrottle {
  private last = Number.NEGATIVE_INFINITY;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  wait(): Promise<void> {
    const next = this.chain.then(async () => {
      const delay = this.last + this.intervalMs - this.now();
      if (delay > 0) await this.sleep(delay);
      this.last = this.now();
    });
    this.chain = next.catch(() => {});
    return next;
  }
}

export type ApplyOutcome = 'matched' | 'unmatched' | 'skipped';

interface TrackRow { id: string; artist_id: string; album_id: string | null; album_match_status: string | null }

/** True when the matcher may still change this track (never manual edits or yt-dlp albums). */
function isMatchable(track: TrackRow | undefined, allowUnmatched: boolean): track is TrackRow {
  if (!track || track.album_id) return false;
  return track.album_match_status === null || (allowUnmatched && track.album_match_status === 'unmatched');
}

/**
 * Records the result of a lookup in one transaction. A match upserts the
 * album by (artist, iTunes collection) and fills only its empty fields, then
 * links the track and fills only its empty track number and genre. No match
 * marks the track 'unmatched'. A track that gained an album or a manual edit
 * meanwhile is left alone ('skipped'); one with an album but no status is
 * marked 'manual'.
 */
export function applyAlbumMatch(
  db: Database.Database,
  trackId: string,
  match: ItunesMatch | null,
  opts: { now?: number; allowUnmatched?: boolean } = {},
): ApplyOutcome {
  const now = opts.now ?? Date.now();
  return db.transaction((): ApplyOutcome => {
    const track = db.prepare('SELECT id, artist_id, album_id, album_match_status FROM music_tracks WHERE id = ?').get(trackId) as TrackRow | undefined;
    if (!isMatchable(track, opts.allowUnmatched === true)) {
      if (track?.album_id && track.album_match_status === null) {
        db.prepare("UPDATE music_tracks SET album_match_status = 'manual' WHERE id = ?").run(trackId);
      }
      return 'skipped';
    }

    if (!match) {
      db.prepare("UPDATE music_tracks SET album_match_status = 'unmatched', album_match_at = ? WHERE id = ?").run(now, trackId);
      return 'unmatched';
    }

    let album = db.prepare('SELECT id FROM music_albums WHERE artist_id = ? AND external_id = ?').get(track.artist_id, match.collectionId) as { id: string } | undefined;
    if (!album) {
      // An album of the same name from yt-dlp or an admin: adopt it instead of duplicating it.
      album = db.prepare('SELECT id FROM music_albums WHERE artist_id = ? AND external_id IS NULL AND lower(title) = lower(?) ORDER BY created_at LIMIT 1')
        .get(track.artist_id, match.collectionName) as { id: string } | undefined;
      if (album) db.prepare('UPDATE music_albums SET external_id = ? WHERE id = ?').run(match.collectionId, album.id);
    }
    if (album) {
      db.prepare(`
        UPDATE music_albums
        SET cover_url = COALESCE(cover_url, ?), release_year = COALESCE(release_year, ?),
            album_type = COALESCE(album_type, ?), matched_by = COALESCE(matched_by, 'itunes')
        WHERE id = ?
      `).run(match.artworkUrl, match.releaseYear, match.albumType, album.id);
    } else {
      album = { id: crypto.randomUUID() };
      db.prepare(`
        INSERT INTO music_albums (id, artist_id, title, release_year, cover_url, source, created_at, external_id, album_type, matched_by)
        VALUES (?, ?, ?, ?, ?, 'youtube', ?, ?, ?, 'itunes')
      `).run(album.id, track.artist_id, match.collectionName, match.releaseYear, match.artworkUrl, now, match.collectionId, match.albumType);
    }

    db.prepare(`
      UPDATE music_tracks
      SET album_id = ?, track_number = COALESCE(track_number, ?), genre = COALESCE(genre, ?),
          album_match_status = 'matched', album_match_at = ?
      WHERE id = ?
    `).run(album.id, match.trackNumber, match.genre, now, trackId);
    return 'matched';
  })();
}
