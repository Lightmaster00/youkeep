export function usePodcastQueue() {
  const podcastQueue = useState<any[]>('settings_podcast_queue', () => []);
  const podcastHistory = useState<any[]>('settings_podcast_history', () => []);
  const podcastShows = useState<any[]>('settings_podcast_shows', () => []);
  const podcastIsPaused = useState<boolean>('settings_podcast_is_paused', () => false);
  const podcastFailedCount = useState<number>('settings_podcast_failed_count', () => 0);

  const podcastActiveDownloadCount = computed(() => {
    return podcastQueue.value.filter((e: any) => e.download_status === 'downloading').length;
  });

  const fetchPodcastQueue = async () => {
    try {
      const data = await $fetch<any>('/api/admin/podcasts/queue');
      podcastQueue.value = data.queue || [];
      podcastHistory.value = data.history || [];
      podcastShows.value = data.shows || [];
      podcastIsPaused.value = data.isPaused || false;
      podcastFailedCount.value = data.failedCount || 0;
    } catch (err) {
      console.error('Failed to fetch podcast queue:', err);
    }
  };

  return {
    podcastQueue, podcastHistory, podcastShows, podcastIsPaused, podcastFailedCount, podcastActiveDownloadCount,
    fetchPodcastQueue,
  };
}
