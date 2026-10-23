// One abbreviation tier: from `at` upward the count is divided by `div` and
// followed by `unit`.
interface CountTier { at: number; div: number; unit: string }

// Own unit tables instead of Intl's compact notation: the CLDR data inside the
// server's Node and inside the visitor's browser differ ("1500" vs "1,5K" in
// Italian), which broke hydration. Languages absent here (and English) keep the
// plain / "k" / "M" spelling below. Units follow common CLDR spelling.
const COUNT_TIERS: Record<string, { tiers: CountTier[]; gap: string }> = {
  fr: { gap: '\u00a0', tiers: [{ at: 1e3, div: 1e3, unit: 'k' }, { at: 1e6, div: 1e6, unit: 'M' }, { at: 1e9, div: 1e9, unit: 'Md' }] },
  es: { gap: '\u00a0', tiers: [{ at: 1e3, div: 1e3, unit: 'mil' }, { at: 1e6, div: 1e6, unit: 'M' }] },
  de: { gap: '\u00a0', tiers: [{ at: 1e6, div: 1e6, unit: 'Mio.' }, { at: 1e9, div: 1e9, unit: 'Mrd.' }] },
  pt: { gap: '\u00a0', tiers: [{ at: 1e3, div: 1e3, unit: 'mil' }, { at: 1e6, div: 1e6, unit: 'mi' }, { at: 1e9, div: 1e9, unit: 'bi' }] },
  it: { gap: '\u00a0', tiers: [{ at: 1e3, div: 1e3, unit: 'K' }, { at: 1e6, div: 1e6, unit: 'Mln' }, { at: 1e9, div: 1e9, unit: 'Mrd' }] },
  ru: { gap: '\u00a0', tiers: [{ at: 1e3, div: 1e3, unit: 'тыс.' }, { at: 1e6, div: 1e6, unit: 'млн' }, { at: 1e9, div: 1e9, unit: 'млрд' }] },
  zh: { gap: '', tiers: [{ at: 1e4, div: 1e4, unit: '万' }, { at: 1e8, div: 1e8, unit: '亿' }] },
  ja: { gap: '', tiers: [{ at: 1e4, div: 1e4, unit: '万' }, { at: 1e8, div: 1e8, unit: '億' }] }
};

/**
 * A view count as shown on a card: English keeps the short "1.2k" / "1.5M"
 * spelling, every other language gets its own units ("1,2 k", "1,5 Mio.",
 * "150万") with the decimal separator of the UI language.
 */
export function formatViewCount(count: number | null | undefined, locale: string): string {
  if (count === null || count === undefined || !count) return '0';
  const lang = locale.toLowerCase().split('-')[0] ?? 'en';
  const table = COUNT_TIERS[lang];
  if (lang === 'en' || !table) {
    if (lang !== 'en') return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(count);
    if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(count);
  }
  const tiers = table.tiers;
  let index = -1;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (count >= tiers[i]!.at) { index = i; break; }
  }
  if (index < 0) return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(count);
  // 999 950 would round to "1000 k": step up to the next unit instead.
  const rounded = Math.round((count / tiers[index]!.div) * 10) / 10;
  const next = tiers[index + 1];
  if (next && rounded * tiers[index]!.div >= next.at) index++;
  const tier = tiers[index]!;
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.round((count / tier.div) * 10) / 10);
  return value + table.gap + tier.unit;
}

/** "March 15, 2026, 09:05" built from separately formatted parts: the date+time joiner of Intl differs between engines. */
export function formatDateTime(date: Date, locale: string, dateOpts: Intl.DateTimeFormatOptions): string {
  const day = date.toLocaleDateString(locale, dateOpts);
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const lang = locale.toLowerCase().split('-')[0];
  return `${day}${lang === 'zh' || lang === 'ja' ? ' ' : ', '}${time}`;
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
