import { computed } from 'vue';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';
import { useMusicQueue } from '~/composables/useMusicQueue';
import { usePodcastQueue } from '~/composables/usePodcastQueue';
import {
  toQueueItem, filterCounts, visibleQueue, capNotice, nextPollDelay,
  type DownloadFilter, type DownloadKind, type QueueItem, type TypeQueueState,
} from '~/utils/allDownloads';

// Module-level so that every caller shares the single polling loop.
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

export function useAllDownloads() {
  const video = useDownloadsQueue();
  const music = useMusicQueue();
  const podcast = usePodcastQueue();
  const filter = useState<DownloadFilter>('settings_downloads_filter', () => 'all');

  const states = computed<Record<DownloadKind, TypeQueueState>>(() => ({
    video: {
      items: video.queue.value.map((raw) => toQueueItem('video', raw)),
      total: video.queueTotal.value,
      failedCount: video.failedCount.value,
      isPaused: video.isPaused.value,
      error: video.queueError.value,
    },
    music: {
      items: music.musicQueue.value.map((raw) => toQueueItem('music', raw)),
      total: music.musicQueueTotal.value,
      failedCount: music.musicFailedCount.value,
      isPaused: music.musicIsPaused.value,
      error: music.musicQueueError.value,
    },
    podcast: {
      items: podcast.podcastQueue.value.map((raw) => toQueueItem('podcast', raw)),
      total: podcast.podcastQueueTotal.value,
      failedCount: podcast.podcastFailedCount.value,
      isPaused: podcast.podcastIsPaused.value,
      error: podcast.podcastQueueError.value,
    },
  }));

  const counts = computed(() => filterCounts(states.value));
  const visible = computed(() => visibleQueue(states.value, filter.value));
  const notice = computed(() => capNotice(visible.value.items.length, visible.value.total));

  // Videos keep their smooth (interpolated) progress bar.
  function progressFor(item: QueueItem): number {
    if (item.kind === 'video') {
      const smooth = video.smoothProgress.value[item.id];
      if (smooth !== undefined) return smooth;
    }
    return item.progress;
  }

  async function refreshAll() {
    // Each fetch* catches its own error and flags its type, so one failure never blocks the others.
    await Promise.all([video.fetchQueue(), music.fetchMusicQueue(), podcast.fetchPodcastQueue()]);
  }

  async function tick() {
    if (!polling) return;
    await refreshAll();
    if (!polling) return;
    pollTimer = setTimeout(tick, nextPollDelay(states.value));
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    tick();
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    video.stopSmoothProgressLoop();
  }

  return { filter, states, counts, visible, notice, progressFor, refreshAll, startPolling, stopPolling };
}
