import { computed } from 'vue';

export interface ActiveCounts {
  video: { downloading: number; pending: number };
  music: { downloading: number; pending: number };
  podcasts: { downloading: number; pending: number };
  total: number;
  current: { kind: 'video' | 'music' | 'podcasts' | null; progress: number | null; speed: string | null };
}

// Lightweight "what is downloading" counters shared by the Settings tab badge
// and the Overview Activity card. Reads the same endpoint as the sidebar badge.
export function useActiveCounts() {
  const counts = useState<ActiveCounts | null>('admin_active_counts', () => null);

  const downloadingTotal = computed(() => {
    const c = counts.value;
    return c ? c.video.downloading + c.music.downloading + c.podcasts.downloading : 0;
  });

  const queuedTotal = computed(() => {
    const c = counts.value;
    return c ? c.video.pending + c.music.pending + c.podcasts.pending : 0;
  });

  async function fetchActiveCounts() {
    try {
      counts.value = await $fetch<ActiveCounts>('/api/admin/downloader/active-counts');
    } catch {
      // Not critical: keep the last known value.
    }
  }

  return { counts, downloadingTotal, queuedTotal, fetchActiveCounts };
}
