export interface HistoryDay<T> {
  key: string;
  label: string;
  items: T[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Heading of one day of a listening history, in the viewer's local time:
// "Today", "Yesterday", else the date (with the year only when it differs).
// `opts` carries the UI language: its locale for the date and the words for
// today / yesterday (English by default).
export interface DayLabelOptions { locale?: string; today?: string; yesterday?: string }

export function historyDayLabel(timestamp: number, now: number = Date.now(), opts: DayLabelOptions = {}): string {
  const { locale = 'en-US', today: todayLabel = 'Today', yesterday: yesterdayLabel = 'Yesterday' } = opts;
  const day = new Date(timestamp);
  const today = new Date(now);
  if (dayKey(day) === dayKey(today)) return todayLabel;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(day) === dayKey(yesterday)) return yesterdayLabel;
  return day.toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

// Groups an already newest-first list into consecutive days, keeping the order.
export function groupByDay<T>(items: T[], timestampOf: (item: T) => number, now: number = Date.now(), opts: DayLabelOptions = {}): HistoryDay<T>[] {
  const days: HistoryDay<T>[] = [];
  for (const item of items) {
    const ts = timestampOf(item);
    const key = dayKey(new Date(ts));
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(item);
    else days.push({ key, label: historyDayLabel(ts, now, opts), items: [item] });
  }
  return days;
}
