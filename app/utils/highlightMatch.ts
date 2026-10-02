function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findRange(escapedText: string, escapedNeedle: string): [number, number] | null {
  const match = escapedText.match(new RegExp(escapeRegExp(escapedNeedle), 'i'));
  if (!match || match.index === undefined) return null;
  return [match.index, match.index + match[0].length];
}

export function highlightMatch(text: string, query: string): string {
  const escapedText = escapeHtml(text);
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return escapedText;

  // Whole phrase first; if it does not appear contiguously (full-text search
  // matches words independently, e.g. "rock roll" -> "Rock & Roll"), highlight
  // the first occurrence of each word instead.
  const whole = findRange(escapedText, escapeHtml(trimmedQuery));
  const ranges: [number, number][] = whole
    ? [whole]
    : trimmedQuery
        .split(/\s+/)
        .map((word) => findRange(escapedText, escapeHtml(word)))
        .filter((r): r is [number, number] => r !== null)
        .sort((x, y) => x[0] - y[0]);

  let result = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue; // skip overlaps
    result += `${escapedText.slice(cursor, start)}<mark>${escapedText.slice(start, end)}</mark>`;
    cursor = end;
  }
  return result + escapedText.slice(cursor);
}
