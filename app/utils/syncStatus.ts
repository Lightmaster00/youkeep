import type { DownloadKind } from '~/utils/allDownloads';

// The body of GET /api/admin/sync-status (see server/utils/autoSync.ts).
export interface SyncTypeStatus {
  enabled: boolean;
  schedule: string;
  lastSyncAt: number | null;
  lastSyncStartedAt: number | null;
  nextRunAt: number | null;
  running?: boolean;
  stuck: boolean;
}
export type SyncStatus = Record<DownloadKind, SyncTypeStatus>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function unit(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "just now", "5 minutes ago", "3 days ago", "in 2 hours", "in 4 minutes". */
export function relativeTime(at: number, now: number): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return diff < 0 ? 'just now' : 'in less than a minute';
  let text: string;
  if (abs < HOUR) text = unit(Math.round(abs / MINUTE), 'minute');
  else if (abs < DAY) text = unit(Math.round(abs / HOUR), 'hour');
  else text = unit(Math.round(abs / DAY), 'day');
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

/** "Last sync: 2 hours ago · Next: in 4 hours" (Next: Off when the schedule is off). */
export function syncLine(s: SyncTypeStatus, now: number): string {
  const last = s.running ? 'running now' : s.lastSyncAt ? relativeTime(s.lastSyncAt, now) : 'never';
  const next = !s.enabled ? 'Off' : s.nextRunAt ? relativeTime(s.nextRunAt, now) : 'Off';
  return `Last sync: ${last} · Next: ${next}`;
}

/** The red notice of a stuck automatic sync, or null. */
export function stuckNotice(s: SyncTypeStatus, now: number): string | null {
  if (!s.stuck || !s.lastSyncAt) return null;
  return `Automatic sync looks stuck — last sync ${relativeTime(s.lastSyncAt, now)}.`;
}

/** True for a well-formed status body (anything else is ignored by the card). */
export function isSyncStatus(value: unknown): value is SyncStatus {
  if (!value || typeof value !== 'object') return false;
  return (['video', 'music', 'podcast'] as const).every((k) => {
    const s = (value as any)[k];
    return !!s && typeof s === 'object' && typeof s.enabled === 'boolean';
  });
}
