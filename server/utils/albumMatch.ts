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
export const ITUNES_LOOKUP_URL = 'https://itunes.apple.com/lookup';
export const ITUNES_TIMEOUT_MS = 8_000;
// High enough that the original album is among the results, next to compilations and covers.
export const ITUNES_RESULT_LIMIT = 25;
// Distinct collections whose own release date is looked up (in one request).
export const MAX_COLLECTION_LOOKUPS = 4;
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

// Words of a bracketed tag that only describes the upload or the edition, never the song.
const NOISE_WORDS = /\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|explicit|clean|dirty|uncensored|censored|remaster(?:ed)?|radio edit|edit|edited version|album version|single version|soundtrack version|explicit version|clean version|mono|stereo)\b/iu;
const LIVE_WORDS = /\blive\b/iu;
// Innermost bracketed group: "(...)" or "[...]" without nested brackets.
const INNER_GROUP = /\s*[(\[]([^()\[\]]*)[)\]]/gu;
// A " - Remastered 2011" / " - Live" style suffix, as stores write tags.
const DASH_TAG = /\s+[-–—]\s+([^-–—]+)$/u;
const FEAT_TAIL = /\s*[(\[]?\s*\b(?:feat\.?|ft\.?|featuring)(?=\s|$)[\s\S]*$/iu;
const PIPE_TAIL = /\s*\|[\s\S]*$/u;
const DASH_SEPARATOR = /\s+[-–—]\s+/u;

function isDroppableTag(content: string, dropLive: boolean): boolean {
  return NOISE_WORDS.test(content) || (dropLive && LIVE_WORDS.test(content));
}

/** Removes bracketed and " - " suffixed tags that describe the upload (and, if asked, live recordings). */
function stripTags(title: string, dropLive: boolean): string {
  let result = title;
  let previous: string;
  do {
    previous = result;
    result = result.replace(INNER_GROUP, (group, content: string) => (isDroppableTag(content, dropLive) ? '' : group));
    const dash = result.match(DASH_TAG);
    if (dash && dash.index !== undefined && isDroppableTag(dash[1]!, dropLive)) result = result.slice(0, dash.index);
  } while (result !== previous);
  return result.replace(/\s+/g, ' ').trim();
}

/** The title without any bracketed group at all. */
function withoutGroups(title: string): string {
  let result = title;
  let previous: string;
  do {
    previous = result;
    result = result.replace(INNER_GROUP, '');
  } while (result !== previous);
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Strips what YouTube uploads add around a song title: "(Official Video)",
 * "[HD]", "(Explicit)", "(Remastered 2011)", "(Radio Edit)", "(Live ...)",
 * "| Official ..." and "feat. ..." tails, and an "Artist - " prefix. Other
 * groups, like "(Interlude)", are kept. The result is NFC-normalised with
 * single spaces.
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
  result = stripTags(result, true);
  result = result.replace(FEAT_TAIL, '');
  result = stripTags(result, true);
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

const EDITION_WORDS = /\b(?:deluxe|edition|anniversary|remaster(?:ed)?|expanded|explicit|clean|bonus|special|version|reissue)\b/iu;

/**
 * The album's name without edition tags: "Homework (25th Anniversary
 * Edition)" and "Homework" are the same album.
 */
export function stripEditionSuffix(name: string): string {
  let result = String(name ?? '').trim();
  let previous: string;
  do {
    previous = result;
    result = result.replace(INNER_GROUP, (group, content: string) => (EDITION_WORDS.test(content) ? '' : group));
  } while (result !== previous);
  return result.replace(/\s+/g, ' ').trim() || String(name ?? '').trim();
}

const DERIVATIVE_COLLECTION = /\b(?:greatest hits|hits|best of|collection|anthology|essentials?|complete|the very best|live|karaoke|tribute|mix|mixes)\b/iu;
const REMIX_WORDS = /\bremix(?:es)?\b/iu;

/** Compilations and derivative releases are only chosen when nothing else matches. */
export function isDerivativeCollection(name: string, trackTitle: string): boolean {
  if (DERIVATIVE_COLLECTION.test(name)) return true;
  return REMIX_WORDS.test(name) && !REMIX_WORDS.test(trackTitle);
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

function dateTime(value: unknown): number {
  const t = Date.parse(typeof value === 'string' ? value : '');
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** What a collection lookup tells about an album. */
export interface CollectionInfo {
  releaseDate: string | null;
  trackCount: number | null;
  collectionType: string | null;
}

interface Candidate {
  raw: any;
  collectionId: string;
  hasEditionTag: boolean;
  trackTime: number;
}

export interface CandidateGroup {
  key: string;
  label: string;
  type: AlbumType;
  derivative: boolean;
  members: Candidate[];
  order: number;
}

/**
 * The accepted search results, grouped by album (editions of one album are
 * one group) and ordered before any lookup: original releases first, albums
 * before singles/EPs, then the earliest song date. A result is accepted when
 * its artist is equal to, contains or is contained in the track's artist,
 * and its title (upload tags removed) has the same key as the track's, with
 * or without the track's own bracketed groups; when no result does, a
 * similarity of at least 0.9 is enough.
 */
export function candidateGroups(results: any[], artistName: string, cleanedTitle: string): CandidateGroup[] {
  const artistKey = normaliseKey(artistName);
  const titleKey = normaliseKey(cleanedTitle);
  const bareTitleKey = normaliseKey(withoutGroups(cleanedTitle));
  if (!artistKey || !titleKey || !Array.isArray(results)) return [];

  const exact: any[] = [];
  const close: any[] = [];
  for (const raw of results) {
    if (!raw || (raw.wrapperType && raw.wrapperType !== 'track') || (raw.kind && raw.kind !== 'song')) continue;
    if (raw.collectionId === undefined || raw.collectionId === null || !raw.collectionName) continue;
    if (!artistMatches(raw.artistName, artistKey)) continue;
    const songTitle = stripTags(String(raw.trackName ?? '').normalize('NFC').replace(FEAT_TAIL, ''), false);
    const candidateKey = normaliseKey(songTitle);
    if (!candidateKey) continue;
    if (candidateKey === titleKey || (bareTitleKey && candidateKey === bareTitleKey)) exact.push(raw);
    else if (keySimilarity(candidateKey, titleKey) >= TITLE_SIMILARITY_THRESHOLD) close.push(raw);
  }

  const groups = new Map<string, CandidateGroup>();
  (exact.length ? exact : close).forEach((raw, index) => {
    const { title, type } = parseCollectionName(raw.collectionName);
    const label = stripEditionSuffix(title);
    const key = `${type}\u0000${normaliseKey(label)}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label, type, derivative: isDerivativeCollection(label, cleanedTitle), members: [], order: index };
      groups.set(key, group);
    }
    group.members.push({ raw, collectionId: String(raw.collectionId), hasEditionTag: label !== title, trackTime: dateTime(raw.releaseDate) });
  });

  const typeRank = (g: CandidateGroup) => (g.type === 'album' ? 0 : 1);
  const earliest = (g: CandidateGroup) => Math.min(...g.members.map((m) => m.trackTime));
  return [...groups.values()].sort((a, b) =>
    Number(a.derivative) - Number(b.derivative) || typeRank(a) - typeRank(b) || earliest(a) - earliest(b) || a.order - b.order);
}

function memberOrder(collections: Map<string, CollectionInfo>) {
  return (a: Candidate, b: Candidate) =>
    dateTime(collections.get(a.collectionId)?.releaseDate) - dateTime(collections.get(b.collectionId)?.releaseDate)
    || Number(a.hasEditionTag) - Number(b.hasEditionTag)
    || (collections.get(a.collectionId)?.trackCount ?? Infinity) - (collections.get(b.collectionId)?.trackCount ?? Infinity)
    || a.trackTime - b.trackTime;
}

/** The distinct collections of the best groups whose release date is worth looking up (none when only one is possible). */
export function collectionsToLookUp(groups: CandidateGroup[], max = MAX_COLLECTION_LOOKUPS): string[] {
  const ids: string[] = [];
  for (const group of groups) {
    for (const member of [...group.members].sort(memberOrder(new Map()))) {
      if (!ids.includes(member.collectionId)) ids.push(member.collectionId);
    }
  }
  return ids.length > 1 ? ids.slice(0, max) : [];
}

/**
 * Picks the album among the groups, using the looked-up collections: an
 * original release (not a compilation, not a non-"Album" collection type)
 * before a derivative one, an album before a single/EP, a looked-up
 * collection before one that was not, then the earliest collection release.
 * Within the group, the earliest edition (the one without an edition tag on
 * a tie) gives the collection id; the group's label is the album title.
 */
export function chooseMatch(groups: CandidateGroup[], collections: Map<string, CollectionInfo> = new Map()): ItunesMatch | null {
  if (!groups.length) return null;
  const sortMembers = memberOrder(collections);
  const scored = groups.map((group) => {
    const members = [...group.members].sort(sortMembers);
    const best = members[0]!;
    const info = collections.get(best.collectionId);
    const unknownType = !!info?.collectionType && info.collectionType !== 'Album';
    return {
      group,
      best,
      info,
      derivative: group.derivative || unknownType,
      lookedUp: info ? 0 : 1,
      collectionTime: info ? dateTime(info.releaseDate) : best.trackTime,
    };
  });
  scored.sort((a, b) =>
    Number(a.derivative) - Number(b.derivative)
    || (a.group.type === 'album' ? 0 : 1) - (b.group.type === 'album' ? 0 : 1)
    || a.lookedUp - b.lookedUp
    || a.collectionTime - b.collectionTime
    || a.group.order - b.group.order);
  const winner = scored[0]!;
  const raw = winner.best.raw;
  const year = Number.parseInt(String(winner.info?.releaseDate ?? raw.releaseDate ?? '').slice(0, 4), 10);
  const trackNumber = Number(raw.trackNumber);
  const genre = typeof raw.primaryGenreName === 'string' && raw.primaryGenreName.trim() ? raw.primaryGenreName.trim() : null;
  return {
    collectionId: winner.best.collectionId,
    collectionName: winner.group.label,
    albumType: winner.group.type,
    artworkUrl: largeArtworkUrl(raw.artworkUrl100),
    releaseYear: Number.isInteger(year) && year > 1800 ? year : null,
    trackNumber: Number.isInteger(trackNumber) && trackNumber > 0 ? trackNumber : null,
    genre,
  };
}

/** Selection without lookups (the song dates stand in for the collection dates). */
export function pickBestCandidate(results: any[], artistName: string, cleanedTitle: string, collections: Map<string, CollectionInfo> = new Map()): ItunesMatch | null {
  return chooseMatch(candidateGroups(results, artistName, cleanedTitle), collections);
}

/** The two iTunes endpoints used. Both throw on HTTP or network errors. */
export interface ItunesClient {
  search(term: string): Promise<any[]>;
  lookup(collectionIds: string[]): Promise<any[]>;
}

// iTunes answers with a text/javascript content type; an error page is not JSON.
const parseItunesJson = (text: string) => { try { return JSON.parse(text); } catch { return null; } };

async function itunesGet(url: string, params: Record<string, string | number>): Promise<any[]> {
  const data = await (globalThis as any).$fetch(url, { params, parseResponse: parseItunesJson, timeout: ITUNES_TIMEOUT_MS, retry: 0 });
  return Array.isArray(data?.results) ? data.results : [];
}

export const defaultItunesClient: ItunesClient = {
  search: (term) => itunesGet(ITUNES_SEARCH_URL, { term, entity: 'song', media: 'music', limit: ITUNES_RESULT_LIMIT, country: 'US', lang: 'en_us' }),
  lookup: (ids) => itunesGet(ITUNES_LOOKUP_URL, { id: ids.join(','), entity: 'album', country: 'US' }),
};

/** Wraps every request of a client in `throttle` (the process-wide request spacing). */
export function throttledItunesClient(client: ItunesClient, throttle: () => Promise<void>): ItunesClient {
  return {
    search: async (term) => { await throttle(); return client.search(term); },
    lookup: async (ids) => { await throttle(); return client.lookup(ids); },
  };
}

function toCollectionInfos(results: any[]): Map<string, CollectionInfo> {
  const map = new Map<string, CollectionInfo>();
  for (const raw of results) {
    if (!raw || raw.wrapperType !== 'collection' || raw.collectionId === undefined || raw.collectionId === null) continue;
    map.set(String(raw.collectionId), {
      releaseDate: typeof raw.releaseDate === 'string' ? raw.releaseDate : null,
      trackCount: Number.isInteger(raw.trackCount) ? raw.trackCount : null,
      collectionType: typeof raw.collectionType === 'string' ? raw.collectionType : null,
    });
  }
  return map;
}

/**
 * Searches iTunes for one track; null when no result is a match. When
 * several albums are possible, their collections are looked up (one more
 * request) so the original release wins over later compilations. A
 * transient lookup failure is thrown (the caller backs off); any other
 * lookup failure falls back to the song dates.
 */
export async function searchItunesSong(artistName: string, title: string, client: ItunesClient = defaultItunesClient): Promise<ItunesMatch | null> {
  const cleaned = cleanTrackTitle(title, artistName);
  const results = await client.search(`${artistName} ${withoutGroups(cleaned) || cleaned}`);
  const groups = candidateGroups(results, artistName, cleaned);
  if (!groups.length) return null;
  const ids = collectionsToLookUp(groups);
  let collections = new Map<string, CollectionInfo>();
  if (ids.length) {
    try {
      collections = toCollectionInfos(await client.lookup(ids));
    } catch (err) {
      if (isTransientMatchError(err)) throw err;
    }
  }
  return chooseMatch(groups, collections);
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
