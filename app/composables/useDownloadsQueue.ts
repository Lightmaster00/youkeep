let lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
let animationFrameId: any = null;

export function useDownloadsQueue() {
  const queue = useState<any[]>('settings_downloads_queue', () => []);
  const queueTotal = useState<number>('settings_downloads_queue_total', () => 0);
  const failedCount = useState<number>('settings_downloads_failed_count', () => 0);
  const isPaused = useState<boolean>('settings_downloads_is_paused', () => false);
  const smoothProgress = useState<Record<string, number>>('settings_downloads_smooth_progress', () => ({}));
  const progressRates = useState<Record<string, number>>('settings_downloads_progress_rates', () => ({}));
  const diagnosticLogs = useState<string[]>('settings_downloads_diagnostic_logs', () => []);
  const diagnosticYtdlPath = useState<string>('settings_downloads_diagnostic_ytdl_path', () => '');

  const activeDownloadCount = computed(() => {
    return queue.value.filter((v: any) => v.download_status === 'downloading').length;
  });

  const updateSmoothProgress = (now: number) => {
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    let hasActive = false;
    queue.value.forEach((video: any) => {
      const id = video.id;
      const target = video.download_progress || 0;

      if (video.download_status !== 'downloading') {
        smoothProgress.value[id] = target;
        return;
      }

      if (smoothProgress.value[id] === undefined) {
        smoothProgress.value[id] = target;
      }

      const rate = progressRates.value[id] || 0;
      const currentSmooth = smoothProgress.value[id] ?? target;
      if (rate > 0 && currentSmooth < target) {
        const nextProgress = currentSmooth + rate * dt;
        smoothProgress.value[id] = Math.min(nextProgress, target);
        if (smoothProgress.value[id]! < target) {
          hasActive = true;
        }
      }
    });

    if (hasActive || activeDownloadCount.value > 0) {
      animationFrameId = requestAnimationFrame(updateSmoothProgress);
    } else {
      animationFrameId = null;
    }
  };

  watch(() => queue.value, () => {
    queue.value.forEach((video: any) => {
      const id = video.id;
      const target = video.download_progress || 0;

      if (video.download_status !== 'downloading') {
        smoothProgress.value[id] = target;
        progressRates.value[id] = 0;
        return;
      }

      if (smoothProgress.value[id] === undefined) {
        smoothProgress.value[id] = target;
      }

      const currentSmooth = smoothProgress.value[id] ?? target;
      const diff = target - currentSmooth;

      if (diff < -2 || Math.abs(diff) > 40 || target === 0 || target === 100) {
        smoothProgress.value[id] = target;
        progressRates.value[id] = 0;
      } else if (diff > 0) {
        progressRates.value[id] = diff / 1000;
      } else {
        progressRates.value[id] = 0;
      }
    });

    if (!animationFrameId && activeDownloadCount.value > 0) {
      lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      updateSmoothProgress(lastFrameTime);
    }
  }, { deep: true });

  function stopSmoothProgressLoop() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  const fetchQueue = async () => {
    try {
      const data = await $fetch<any>('/api/admin/downloader/queue');
      queue.value = data.queue || [];
      queueTotal.value = typeof data.queueTotal === 'number' ? data.queueTotal : queue.value.length;
      failedCount.value = data.failedCount || 0;
      isPaused.value = data.isPaused || false;
    } catch (err) {
      console.error('Failed to fetch downloader queue:', err);
    }
  };

  const fetchDiagnostics = async () => {
    try {
      const data = await $fetch<any>('/api/admin/downloader/logs');
      diagnosticLogs.value = data.logs || [];
      diagnosticYtdlPath.value = data.ytdlPath || '';
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  return {
    queue, queueTotal, failedCount, isPaused, smoothProgress, activeDownloadCount,
    diagnosticLogs, diagnosticYtdlPath,
    fetchQueue, fetchDiagnostics, stopSmoothProgressLoop,
  };
}
