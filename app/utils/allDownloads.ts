export type DownloadKind = 'video' | 'music' | 'podcast';
export type DownloadFilter = 'all' | DownloadKind;
export type QueueStatus = 'downloading' | 'pending' | 'failed';
export type QueueAction = 'prioritize' | 'cancel' | 'retry';

export interface QueueItem {
  kind: DownloadKind;
  id: string;
  title: string;
  source: string;
  status: QueueStatus;
  progress: number;
  speed: string | null;
  eta: string | null;
  lastError: string | null;
}

export interface TypeQueueState {
  items: QueueItem[];
  /** Everything downloading + queued + failed for this type (the route's queueTotal). */
  total: number;
  failedCount: number;
  isPaused: boolean;
  /** True when the last refresh of this type's queue failed. */
  error: boolean;
}

export const QUEUE_CAP = 100;
export const DOWNLOAD_KINDS: readonly DownloadKind[] = ['video', 'music', 'podcast'];
export const KIND_LABELS: Record<DownloadKind, string> = { video: 'Videos', music: 'Music', podcast: 'Podcasts' };
export const KIND_PILL: Record<DownloadKind, string> = { video: 'Video', music: 'Music', podcast: 'Podcast' };
export const KIND_API_BASE: Record<DownloadKind, string> = {
  video: '/api/admin/downloader',
  music: '/api/admin/music',
  podcast: '/api/admin/podcasts',
};
export const STATUS_LABELS: Record<QueueStatus, string> = { downloading: 'Downloading', pending: 'Queued', failed: 'Failed' };
export const ACTION_LABELS: Record<QueueAction, string> = { prioritize: 'Prioritize', cancel: 'Cancel', retry: 'Retry' };
export const FILTERS: ReadonlyArray<{ key: DownloadFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'video', label: 'Videos' },
  { key: 'music', label: 'Music' },
  { key: 'podcast', label: 'Podcasts' },
];

const SOURCE_FIELD: Record<DownloadKind, string> = { video: 'channel_title', music: 'artist_name', podcast: 'show_title' };

export function toQueueItem(kind: DownloadKind, raw: any): QueueItem {
  const s = raw?.download_status;
  const status: QueueStatus = s === 'downloading' || s === 'failed' ? s : 'pending';
  return {
    kind,
    id: String(raw?.id ?? ''),
    title: String(raw?.title ?? ''),
    source: String(raw?.[SOURCE_FIELD[kind]] ?? ''),
    status,
    progress: Number(raw?.download_progress) || 0,
    speed: raw?.download_speed || null,
    eta: raw?.download_eta || null,
    lastError: raw?.last_error || null,
  };
}

export function emptyTypeState(): TypeQueueState {
  return { items: [], total: 0, failedCount: 0, isPaused: false, error: false };
}

/** Downloading (any type) first, then queued items round-robin by type, then failed. Each type keeps its route order. */
export function mergeQueues(byKind: Record<DownloadKind, QueueItem[]>): QueueItem[] {
  const pick = (status: QueueStatus) => DOWNLOAD_KINDS.map((k) => byKind[k].filter((i) => i.status === status));
  const downloading = pick('downloading').flat();
  const pendingLists = pick('pending');
  const pending: QueueItem[] = [];
  const longest = Math.max(0, ...pendingLists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of pendingLists) {
      if (i < list.length) pending.push(list[i]!);
    }
  }
  const failed = pick('failed').flat();
  return [...downloading, ...pending, ...failed];
}

export function filterCounts(states: Record<DownloadKind, TypeQueueState>): Record<DownloadFilter, number> {
  const video = states.video.total;
  const music = states.music.total;
  const podcast = states.podcast.total;
  return { all: video + music + podcast, video, music, podcast };
}

export function visibleQueue(states: Record<DownloadKind, TypeQueueState>, filter: DownloadFilter): { items: QueueItem[]; total: number } {
  const byKind = {} as Record<DownloadKind, QueueItem[]>;
  for (const k of DOWNLOAD_KINDS) byKind[k] = filter === 'all' || filter === k ? states[k].items : [];
  return { items: mergeQueues(byKind).slice(0, QUEUE_CAP), total: filterCounts(states)[filter] };
}

export function capNotice(shown: number, total: number): string | null {
  return total > shown ? `Showing the first ${shown} of ${total}` : null;
}

export function typeSummary(state: TypeQueueState): { downloading: number; queued: number; failed: number } {
  const downloading = state.items.filter((i) => i.status === 'downloading').length;
  return { downloading, queued: Math.max(0, state.total - state.failedCount - downloading), failed: state.failedCount };
}

export function nextPollDelay(states: Record<DownloadKind, TypeQueueState>): number {
  return DOWNLOAD_KINDS.some((k) => states[k].items.some((i) => i.status === 'downloading')) ? 500 : 3000;
}

export function queueActionsFor(item: QueueItem): QueueAction[] {
  // Failed items (including cancelled ones) can only be retried; podcasts have no cancel route.
  if (item.status === 'failed') return ['retry'];
  if (item.kind === 'video') return item.status === 'pending' ? ['prioritize', 'cancel'] : ['cancel'];
  if (item.kind === 'music') return ['cancel'];
  return [];
}

export function queueActionRequest(item: QueueItem, action: QueueAction): { url: string; body?: Record<string, string> } {
  if (item.kind === 'video' && action === 'prioritize') return { url: '/api/admin/downloader/prioritize', body: { videoId: item.id } };
  if (item.kind === 'video' && action === 'cancel') return { url: '/api/admin/downloader/cancel', body: { videoId: item.id } };
  if (item.kind === 'music' && action === 'cancel') return { url: `/api/admin/music/tracks/${encodeURIComponent(item.id)}/cancel` };
  if (item.kind === 'video' && action === 'retry') return { url: '/api/admin/downloader/retry-failed', body: { videoId: item.id } };
  if (item.kind === 'music' && action === 'retry') return { url: '/api/admin/music/retry-failed', body: { trackId: item.id } };
  if (item.kind === 'podcast' && action === 'retry') return { url: '/api/admin/podcasts/retry-failed', body: { episodeId: item.id } };
  throw new Error(`Unsupported queue action "${action}" for ${item.kind}`);
}
