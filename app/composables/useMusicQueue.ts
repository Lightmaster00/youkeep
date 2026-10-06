export function useMusicQueue() {
  const musicQueue = useState<any[]>('settings_music_queue', () => []);
  const musicQueueTotal = useState<number>('settings_music_queue_total', () => 0);
  const musicQueueError = useState<boolean>('settings_music_queue_error', () => false);
  const musicHistory = useState<any[]>('settings_music_history', () => []);
  const musicArtists = useState<any[]>('settings_music_artists', () => []);
  const musicIsPaused = useState<boolean>('settings_music_is_paused', () => false);
  const musicFailedCount = useState<number>('settings_music_failed_count', () => 0);

  const musicActiveDownloadCount = computed(() => {
    return musicQueue.value.filter((t: any) => t.download_status === 'downloading').length;
  });

  const fetchMusicQueue = async () => {
    try {
      const data = await $fetch<any>('/api/admin/music/queue');
      musicQueue.value = data.queue || [];
      musicQueueTotal.value = typeof data.queueTotal === 'number' ? data.queueTotal : musicQueue.value.length;
      musicHistory.value = data.history || [];
      musicArtists.value = data.artists || [];
      musicIsPaused.value = data.isPaused || false;
      musicFailedCount.value = data.failedCount || 0;
      musicQueueError.value = false;
    } catch (err) {
      musicQueueError.value = true;
      console.error('Failed to fetch music queue:', err);
    }
  };

  return {
    musicQueue, musicQueueTotal, musicQueueError, musicHistory, musicArtists, musicIsPaused, musicFailedCount, musicActiveDownloadCount,
    fetchMusicQueue,
  };
}
