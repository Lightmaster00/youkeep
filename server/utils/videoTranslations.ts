import type Database from 'better-sqlite3';
import { isLanguageCode, type LanguageCode } from '../../shared/languages';
import { describeErrorForLog } from './redact';

// Per-user language for video titles and descriptions, from the YouTube Data
// API (videos.list, part=localizations). Translations are cached in
// video_translations; a row with NULL title and description is a negative
// entry ("YouTube has no translation"). Lists are overlaid from the cache in
// one query and misses are fetched in the background, so a request never
// waits for the network.

export type Localizations = Record<string, { title?: string; description?: string }>;
export interface CachedTranslation { title: string | null; description: string | null; fetchedAt: number }

/** Validity of a negative entry, and of a positive one before it is refreshed. */
export const NEGATIVE_TTL_MS = 14 * 86_400_000;
export const POSITIVE_TTL_MS = 30 * 86_400_000;
const BATCH_SIZE = 50;
const MAX_QUEUED = 200;
const FETCH_TIMEOUT_MS = 10_000;
const IN_CHUNK = 500;

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const primary = (tag: string) => tag.toLowerCase().split(/[-_]/)[0] ?? '';

/**
 * The localization YouTube holds for `lang`: the exact key first, then a
 * regional variant of the same language (pt-BR, zh-Hans). Chinese prefers the
 * simplified variants (Hans, CN, SG). Entries with neither text are skipped.
 */
export function pickLocalization(localizations: Localizations | null | undefined, lang: LanguageCode): { title: string | null; description: string | null } | null {
  if (!localizations || typeof localizations !== 'object') return null;
  const keys = Object.keys(localizations);
  const rank = (key: string): number => {
    const k = key.toLowerCase().replace('_', '-');
    if (k === lang) return 0;
    if (lang === 'zh') {
      if (/(^|-)(hans|cn|sg)$/.test(k)) return 1;
      return 2;
    }
    return 1;
  };
  const candidates = keys.filter((k) => primary(k) === lang).sort((a, b) => rank(a) - rank(b));
  for (const key of candidates) {
    const entry = localizations[key];
    const title = clean(entry?.title);
    const description = clean(entry?.description);
    if (title || description) return { title, description };
  }
  return null;
}

export interface FetchedVideo { localizations: Localizations; defaultLanguage: string | null }

/**
 * Localizations of `ids`, 50 per request. Only ids of a batch that succeeded
 * are in the result (an id YouTube does not return maps to an empty entry);
 * after the first failed batch (quota, 403, network) nothing more is asked.
 */
export async function fetchLocalizations(ids: string[], apiKey: string): Promise<Map<string, FetchedVideo>> {
  const out = new Map<string, FetchedVideo>();
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    try {
      const data: any = await globalThis.$fetch<any>('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'localizations,snippet',
          id: batch.join(','),
          key: apiKey,
          maxResults: BATCH_SIZE,
          fields: 'items(id,localizations,snippet(defaultLanguage))',
        },
        parseResponse: JSON.parse,
        timeout: FETCH_TIMEOUT_MS,
      });
      const found = new Map<string, FetchedVideo>();
      for (const item of Array.isArray(data?.items) ? data.items : []) {
        if (typeof item?.id !== 'string') continue;
        found.set(item.id, {
          localizations: item.localizations && typeof item.localizations === 'object' ? item.localizations : {},
          defaultLanguage: typeof item.snippet?.defaultLanguage === 'string' ? item.snippet.defaultLanguage : null,
        });
      }
      for (const id of batch) out.set(id, found.get(id) ?? { localizations: {}, defaultLanguage: null });
    } catch (err) {
      // The key travels in the query string: never log the raw message.
      console.error('[videoTranslations] YouTube Data API failed:', describeErrorForLog(err, [apiKey]));
      break;
    }
  }
  return out;
}

/** The cached rows (positive and negative) of `ids` for `lang`, in one query per 500 ids. */
export function getVideoTranslations(db: Database.Database, ids: string[], lang: LanguageCode): Map<string, CachedTranslation> {
  const out = new Map<string, CachedTranslation>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    const rows = db.prepare(
      `SELECT video_id, title, description, fetched_at FROM video_translations WHERE lang = ? AND video_id IN (${chunk.map(() => '?').join(',')})`,
    ).all(lang, ...chunk) as { video_id: string; title: string | null; description: string | null; fetched_at: number }[];
    for (const r of rows) out.set(r.video_id, { title: r.title, description: r.description, fetchedAt: r.fetched_at });
  }
  return out;
}

/** Whether a cached row needs a refetch (missing, expired negative, or old positive). */
function isStale(entry: CachedTranslation | undefined, now: number): boolean {
  if (!entry) return true;
  const negative = entry.title === null && entry.description === null;
  return now - entry.fetchedAt > (negative ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS);
}

/**
 * Replaces `title` (and `description` when the row carries one) of rows with
 * a cached translation, in place. The replaced title is kept as
 * `original_title`. Returns the ids to (re)fetch: not cached, or expired.
 * A stale positive entry is still shown while it is refreshed.
 */
export function overlayVideoText(db: Database.Database, rows: any[], lang: LanguageCode, now: number = Date.now()): string[] {
  // A row object listed twice must be translated once.
  const targets = [...new Set(rows)].filter((r) => r && typeof r.id === 'string' && typeof r.title === 'string');
  if (targets.length === 0) return [];
  const cache = getVideoTranslations(db, targets.map((r) => r.id), lang);
  const stale = new Set<string>();
  for (const row of targets) {
    const entry = cache.get(row.id);
    if (isStale(entry, now)) stale.add(row.id);
    if (!entry) continue;
    if (entry.title && entry.title !== row.title) {
      row.original_title = row.title;
      row.title = entry.title;
    }
    if (entry.description && typeof row.description === 'string') row.description = entry.description;
  }
  return [...stale];
}

/** Gets the database the way request handlers do (a global in the Nitro runtime). */
const currentDb = (): Database.Database => (globalThis as any).getDb();

/** The configured YouTube Data API key, or '' when none. */
export function getYoutubeApiKey(db: Database.Database): string {
  try {
    const row = db.prepare("SELECT api_key FROM search_platforms WHERE id = 'youtube_data_api'").get() as { api_key: string } | undefined;
    return row?.api_key || '';
  } catch {
    return '';
  }
}

// --- Background fetching -------------------------------------------------

const pending = new Set<string>();      // "lang:id" queued or in flight
let queue: { lang: LanguageCode; id: string }[] = [];
let draining: Promise<void> | null = null;

function store(db: Database.Database, lang: LanguageCode, fetched: Map<string, FetchedVideo>, now: number): void {
  // The video may have been deleted meanwhile: insert only for existing ones.
  const insert = db.prepare(`
    INSERT OR REPLACE INTO video_translations (video_id, lang, title, description, fetched_at)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM videos WHERE id = ?)
  `);
  db.transaction(() => {
    for (const [id, video] of fetched) {
      // A video already written in this language has nothing to translate.
      const picked = primary(video.defaultLanguage ?? '') === lang ? null : pickLocalization(video.localizations, lang);
      insert.run(id, lang, picked?.title ?? null, picked?.description ?? null, now, id);
    }
  })();
}

async function drain(): Promise<void> {
  while (queue.length > 0) {
    const lang = queue[0]!.lang;
    const batch = queue.filter((q) => q.lang === lang).slice(0, BATCH_SIZE);
    const taken = new Set(batch);
    queue = queue.filter((q) => !taken.has(q));
    try {
      const db = currentDb();
      const apiKey = getYoutubeApiKey(db);
      if (apiKey) {
        const fetched = await fetchLocalizations(batch.map((b) => b.id), apiKey);
        // Nothing is written for a failed batch, so it is retried later.
        if (fetched.size > 0) store(db, lang, fetched, Date.now());
      }
    } catch (err) {
      console.error('[videoTranslations] batch failed:', describeErrorForLog(err));
    } finally {
      for (const b of batch) pending.delete(`${b.lang}:${b.id}`);
    }
  }
}

/**
 * Fire-and-forget: fetches the translations of `ids` into the cache. Does
 * nothing without a configured key; ids already queued or in flight are
 * skipped, at most 200 wait in the queue and one batch runs at a time.
 * Never throws.
 */
export function scheduleTranslationFetch(ids: string[], lang: LanguageCode): void {
  try {
    if (ids.length === 0 || !isLanguageCode(lang)) return;
    if (!getYoutubeApiKey(currentDb())) return;
    for (const id of ids) {
      if (queue.length >= MAX_QUEUED) break;
      const key = `${lang}:${id}`;
      if (pending.has(key)) continue;
      pending.add(key);
      queue.push({ lang, id });
    }
    if (!draining && queue.length > 0) {
      draining = drain().catch(() => {}).finally(() => { draining = null; });
    }
  } catch {
    // Background work must never fail a request.
  }
}

/** Resolves once the background queue is empty (for tests and shutdown). */
export async function whenTranslationQueueIdle(): Promise<void> {
  while (draining) await draining;
}

/** The viewer's content language, or null for the original text. */
export function getContentLanguage(db: Database.Database, userId: string | undefined | null): LanguageCode | null {
  if (!userId) return null;
  const row = db.prepare('SELECT content_language FROM users WHERE id = ?').get(userId) as { content_language: string | null } | undefined;
  return isLanguageCode(row?.content_language) ? row!.content_language as LanguageCode : null;
}

/**
 * The one call routes make: translates `rows` for a signed-in viewer who
 * chose a content language and schedules the missing fetches. Guests and
 * "original" viewers cost nothing.
 */
export function applyVideoTextLanguage(db: Database.Database, viewer: { id: string } | null, rows: any[]): void {
  if (!viewer || rows.length === 0) return;
  try {
    const lang = getContentLanguage(db, viewer.id);
    if (!lang) return;
    scheduleTranslationFetch(overlayVideoText(db, rows, lang), lang);
  } catch (err) {
    console.error('[videoTranslations] overlay failed:', describeErrorForLog(err));
  }
}
