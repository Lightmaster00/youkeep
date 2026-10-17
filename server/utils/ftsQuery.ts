/**
 * Bounds for a full-text search typed by anyone (guests included). The
 * database is synchronous: every word becomes a phrase query, and a
 * one-letter prefix (`"a"*`) expands to a large part of the index, so an
 * unbounded query (1000 one-letter words) froze the server for seconds.
 */
export const FTS_MAX_QUERY_CHARS = 200;
export const FTS_MAX_TOKENS = 8;
/** A word shorter than this matches exactly (no prefix `*`). */
export const FTS_MIN_PREFIX_CHARS = 2;

/**
 * Builds the FTS5 MATCH expression for `raw` once per request: text capped at
 * FTS_MAX_QUERY_CHARS characters (never inside a character), words deduped
 * (case-insensitive), at most FTS_MAX_TOKENS of them (extra words ignored),
 * words with no letter or digit dropped, each one quoted (no FTS syntax
 * injection) and prefix-matched from FTS_MIN_PREFIX_CHARS characters.
 * `text` is the capped search text (for a LIKE fallback); `match` is null
 * when nothing searchable is left.
 */
export function buildFtsQuery(raw: unknown): { text: string; match: string | null } {
  const text = [...String(raw ?? '').trim()].slice(0, FTS_MAX_QUERY_CHARS).join('').trim();
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const word of text.split(/\s+/)) {
    if (phrases.length >= FTS_MAX_TOKENS) break;
    if (!word || !/[\p{L}\p{N}]/u.test(word)) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const quoted = `"${word.replace(/"/g, '""')}"`;
    phrases.push([...word].length >= FTS_MIN_PREFIX_CHARS ? `${quoted}*` : quoted);
  }
  return { text, match: phrases.length > 0 ? phrases.join(' AND ') : null };
}
