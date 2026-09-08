function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightMatch(text: string, query: string): string {
  const escapedText = escapeHtml(text);
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return escapedText;

  const pattern = new RegExp(escapeRegExp(escapeHtml(trimmedQuery)), 'i');
  const match = escapedText.match(pattern);
  if (!match || match.index === undefined) return escapedText;

  const start = match.index;
  const end = start + match[0].length;
  return `${escapedText.slice(0, start)}<mark>${escapedText.slice(start, end)}</mark>${escapedText.slice(end)}`;
}
