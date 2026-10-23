/**
 * A view count as shown on a card: English keeps the short "1.2k" / "1.5M"
 * spelling, every other language gets Intl's compact notation ("1,2 k",
 * "1,5 M" in French) so the decimal separator and unit follow the UI language.
 */
export function formatViewCount(count: number | null | undefined, locale: string): string {
  if (count === null || count === undefined || !count) return '0';
  if (locale === 'en' || locale.startsWith('en-')) {
    if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(count);
  }
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(count);
}

/** A `YYYYMMDD` or ISO date as "Mar 5, 2026" in the UI language; the raw text when it is not a date. */
export function formatUploadDate(dateStr: string | null | undefined, locale: string, opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }): string {
  if (!dateStr) return '';
  const date = dateStr.length === 8 && /^\d{8}$/.test(dateStr)
    ? new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`)
    : new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(locale, opts);
}
