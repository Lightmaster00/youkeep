import { computed } from 'vue';
import { createPoller, type Poller } from '~/utils/poller';

// `pending` is what a worker can pick up; `pausedPending` waits for its paused
// channel/artist/show to be resumed and is shown apart.
export interface KindCounts { downloading: number; pending: number; pausedPending?: number }
export interface ActiveCounts {
  video: KindCounts;
  music: KindCounts;
  podcasts: KindCounts;
  total: number;
  current: { kind: 'video' | 'music' | 'podcasts' | null; progress: number | null; speed: string | null };
  // Set when the downloader cannot write to the downloads folder.
  blockedReason?: string | null;
}

/** Why downloads are paused (missing / read-only downloads folder), shared by every admin screen. */
export function useDownloadsBlockedReason() {
  return useState<string | null>('downloads_blocked_reason', () => null);
}

// Lightweight "what is downloading" counters shared by the Settings tab badge
// and the Overview Activity card. Reads the same endpoint as the sidebar badge.
export function useActiveCounts() {
  const counts = useState<ActiveCounts | null>('admin_active_counts', () => null);
  const blockedReason = useDownloadsBlockedReason();

  const downloadingTotal = computed(() => {
    const c = counts.value;
    return c ? c.video.downloading + c.music.downloading + c.podcasts.downloading : 0;
  });

  const queuedTotal = computed(() => {
    const c = counts.value;
    return c ? c.video.pending + c.music.pending + c.podcasts.pending : 0;
  });

  const pausedTotal = computed(() => {
    const c = counts.value;
    return c ? (c.video.pausedPending || 0) + (c.music.pausedPending || 0) + (c.podcasts.pausedPending || 0) : 0;
  });

  async function fetchActiveCounts() {
    try {
      counts.value = await $fetch<ActiveCounts>('/api/admin/downloader/active-counts');
      blockedReason.value = counts.value?.blockedReason || null;
    } catch {
      // Not critical: keep the last known value.
    }
  }

  return { counts, blockedReason, downloadingTotal, queuedTotal, pausedTotal, fetchActiveCounts };
}

// One poll loop for every admin screen that shows these counters (the layout
// badge, the Settings tab badge, the Overview card): each caller holds a
// reference, the loop runs while at least one is held (paused while the tab
// is hidden, see createPoller).
export const ACTIVE_COUNTS_POLL_MS = 5000;
let sharedPoller: Poller | null = null;
let holders = 0;

export function startActiveCountsPolling(): () => void {
  const { fetchActiveCounts } = useActiveCounts();
  holders++;
  if (!sharedPoller) {
    sharedPoller = createPoller(fetchActiveCounts, () => ACTIVE_COUNTS_POLL_MS);
    sharedPoller.start();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    if (holders <= 0 && sharedPoller) {
      sharedPoller.stop();
      sharedPoller = null;
      holders = 0;
    }
  };
}
