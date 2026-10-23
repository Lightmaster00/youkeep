import type Database from 'better-sqlite3';
import { createError } from 'h3';

// Channel categories. `channels.categories` holds the automatic ones: the
// YouTube categories that cover at least CHANNEL_CATEGORY_MIN_SHARE of the
// channel's enriched videos (metadata_enriched_at IS NOT NULL), most frequent
// first, ties alphabetical, at most MAX_AUTO_CATEGORIES. An admin may set
// `channels.categories_override` instead; the effective categories are the
// override when set, else the automatic ones.

export const CHANNEL_CATEGORY_MIN_SHARE = 0.15;
export const MAX_AUTO_CATEGORIES = 3;
export const MAX_OVERRIDE_CATEGORIES = 5;
export const MAX_CATEGORY_NAME_LENGTH = 40;
const MIGRATION_SETTING = 'channel_categories_migrated';

/** SQL expression: the effective categories (a valid JSON array) of channel `c`. */
export function effectiveCategoriesSql(c = 'c'): string {
  return `(CASE WHEN json_valid(${c}.categories_override) THEN ${c}.categories_override
    WHEN json_valid(${c}.categories) THEN ${c}.categories ELSE '[]' END)`;
}

/** Parses a stored categories column; anything that is not a list of strings gives []. */
export function parseCategories(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x !== '') : [];
  } catch {
    return [];
  }
}

/**
 * Recomputes the automatic categories of these channels (every channel when
 * none is given) in one grouped pass over their enriched videos. Returns how
 * many channels changed.
 */
export function recomputeChannelCategories(db: Database.Database, channelIds?: string | string[]): number {
  const ids = channelIds === undefined ? null : (Array.isArray(channelIds) ? channelIds : [channelIds]);
  if (ids && ids.length === 0) return 0;
  const filter = ids ? 'AND v.channel_id IN (SELECT value FROM json_each(?))' : '';
  const params = ids ? [JSON.stringify(ids)] : [];
  const rows = db.prepare(`
    WITH totals AS (
      SELECT v.channel_id, COUNT(*) AS total
      FROM videos v
      WHERE v.metadata_enriched_at IS NOT NULL ${filter}
      GROUP BY v.channel_id
    ),
    counts AS (
      SELECT v.channel_id, j.value AS category, COUNT(*) AS n
      FROM videos v
      JOIN json_each(CASE WHEN json_valid(v.categories) AND json_type(v.categories) = 'array' THEN v.categories ELSE '[]' END) j
      WHERE v.metadata_enriched_at IS NOT NULL AND j.type = 'text' AND j.value <> '' ${filter}
      GROUP BY v.channel_id, j.value
    ),
    ranked AS (
      SELECT k.channel_id, k.category,
             ROW_NUMBER() OVER (PARTITION BY k.channel_id ORDER BY k.n DESC, k.category ASC) AS rn
      FROM counts k
      JOIN totals t ON t.channel_id = k.channel_id
      WHERE k.n * 100 >= t.total * ${Math.round(CHANNEL_CATEGORY_MIN_SHARE * 100)}
    )
    SELECT channel_id, category FROM ranked WHERE rn <= ${MAX_AUTO_CATEGORIES} ORDER BY channel_id, rn
  `).all(...params, ...params) as { channel_id: string; category: string }[];

  const computed = new Map<string, string[]>();
  for (const r of rows) {
    const list = computed.get(r.channel_id) ?? [];
    list.push(r.category);
    computed.set(r.channel_id, list);
  }

  const targets = ids ?? (db.prepare('SELECT id FROM channels').all() as { id: string }[]).map((r) => r.id);
  const update = db.prepare('UPDATE channels SET categories = ? WHERE id = ? AND categories IS NOT ?');
  let changed = 0;
  db.transaction(() => {
    for (const id of targets) {
      const json = JSON.stringify(computed.get(id) ?? []);
      changed += update.run(json, id, json).changes;
    }
  })();
  return changed;
}

/** The channel of each of these videos (for the recompute after a download). */
export function recomputeCategoriesOfVideos(db: Database.Database, videoIds: string[]): number {
  if (videoIds.length === 0) return 0;
  const channels = (db.prepare('SELECT DISTINCT channel_id FROM videos WHERE id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(videoIds)) as { channel_id: string }[]).map((r) => r.channel_id);
  return recomputeChannelCategories(db, channels);
}

/**
 * At startup: the one-off migration computes every channel once; after that,
 * only channels whose categories were never computed and that have enriched
 * videos are.
 */
export function ensureChannelCategories(db: Database.Database): void {
  const flag = db.prepare('SELECT value FROM settings WHERE key = ?').get(MIGRATION_SETTING) as { value: string } | undefined;
  if (flag?.value !== '1') {
    recomputeChannelCategories(db);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(MIGRATION_SETTING, '1');
    return;
  }
  const pending = (db.prepare(`
    SELECT c.id FROM channels c
    WHERE c.categories IS NULL
      AND EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = c.id AND v.metadata_enriched_at IS NOT NULL)
  `).all() as { id: string }[]).map((r) => r.id);
  if (pending.length > 0) recomputeChannelCategories(db, pending);
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * An admin's category list: trimmed names of 1 to 40 characters without
 * control characters, at most 5, duplicates (ignoring case) dropped. null
 * clears the override. Anything else is a 400.
 */
export function sanitizeCategoryOverride(input: unknown): string[] | null {
  if (input === null) return null;
  const bad = (statusMessage: string) => createError({ statusCode: 400, statusMessage });
  if (!Array.isArray(input)) throw bad('Categories must be a list of names, or null.');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') throw bad('Each category must be a text.');
    const name = raw.trim();
    if (name === '') continue;
    if (name.length > MAX_CATEGORY_NAME_LENGTH) throw bad(`A category name has at most ${MAX_CATEGORY_NAME_LENGTH} characters.`);
    if (CONTROL_CHARS.test(name)) throw bad('A category name cannot contain control characters.');
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (out.length > MAX_OVERRIDE_CATEGORIES) throw bad(`A channel has at most ${MAX_OVERRIDE_CATEGORIES} categories.`);
  return out;
}
