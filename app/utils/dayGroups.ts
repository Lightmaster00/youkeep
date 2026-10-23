// Day headings of the Subscriptions page ("Today", "Yesterday", "This week",
// "Earlier"), computed from a video's upload_date (YYYYMMDD) in the viewer's
// local calendar, and the "3 days ago" wording of the channel cards.

export type DayBucket = 'today' | 'yesterday' | 'week' | 'earlier';

// English headings; the pages word them through the catalogue (subscriptions.day.<bucket>).
export const DAY_BUCKET_LABELS: Readonly<Record<DayBucket, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

const DAY_MS = 86_400_000;

/** The local calendar date of YYYYMMDD, or null when it is not one. */
function parseYmd(ymd: string | null | undefined): Date | null {
  if (!ymd || !/^\d{8}$/.test(ymd)) return null;
  const d = new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole calendar days from `date` to `now` (local midnights, so DST-safe). */
function daysBetween(date: Date, now: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / DAY_MS);
}

export function dayBucket(uploadDate: string | null | undefined, now: Date = new Date()): DayBucket {
  const date = parseYmd(uploadDate);
  if (!date) return 'earlier';
  const days = daysBetween(date, now);
  // A date ahead of the viewer's (another time zone) counts as today.
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'earlier';
}

export interface DayGroup<T> {
  bucket: DayBucket;
  label: string;
  items: T[];
}

/**
 * Splits a list into consecutive runs of the same day heading, keeping its
 * order (newest first gives Today, Yesterday, ...; oldest first the reverse).
 */
export function groupByUploadDay<T extends { upload_date?: string | null }>(list: readonly T[], now: Date = new Date()): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of list) {
    const bucket = dayBucket(item.upload_date, now);
    const last = groups[groups.length - 1];
    if (last && last.bucket === bucket) last.items.push(item);
    else groups.push({ bucket, label: DAY_BUCKET_LABELS[bucket], items: [item] });
  }
  return groups;
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "5 months ago", "2 years ago" (in the UI language). */
export function relativeDay(uploadDate: string | null | undefined, now: Date = new Date(), locale: string = 'en'): string {
  const date = parseYmd(uploadDate);
  if (!date) return '';
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const days = Math.max(0, daysBetween(date, now));
  if (days < 7) return relative.format(-days, 'day');
  if (days < 30) return relative.format(-Math.floor(days / 7), 'week');
  if (days < 365) return relative.format(-Math.max(1, Math.floor(days / 30)), 'month');
  return relative.format(-Math.floor(days / 365), 'year');
}
