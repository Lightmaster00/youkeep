// Highlights the search query in a title for v-html. Matching runs on the RAW
// text and every piece is escaped on its own, so a query never lands inside an
// HTML entity (searching "amp" in "Guitar & Amp" must not produce
// "&amp;<mark>amp</mark>;") and the output is always safe markup.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findRange(text: string, needle: string): [number, number] | null {
  if (!needle) return null;
  const match = new RegExp(escapeRegExp(needle), 'iu').exec(text);
  if (!match || match[0].length === 0) return null;
  return [match.index, match.index + match[0].length];
}

export function highlightMatch(text: string, query: string): string {
  const raw = String(text ?? '');
  const trimmedQuery = String(query ?? '').trim();
  if (!trimmedQuery) return escapeHtml(raw);

  // Whole phrase first; if it does not appear contiguously (full-text search
  // matches words independently, e.g. "rock roll" -> "Rock & Roll"), highlight
  // the first occurrence of each word instead.
  const whole = findRange(raw, trimmedQuery);
  const ranges: [number, number][] = whole
    ? [whole]
    : trimmedQuery
        .split(/\s+/)
        .map((word) => findRange(raw, word))
        .filter((r): r is [number, number] => r !== null)
        .sort((x, y) => x[0] - y[0]);

  let result = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue; // skip overlaps
    result += `${escapeHtml(raw.slice(cursor, start))}<mark>${escapeHtml(raw.slice(start, end))}</mark>`;
    cursor = end;
  }
  return result + escapeHtml(raw.slice(cursor));
}
