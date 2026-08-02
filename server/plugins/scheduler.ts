import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { initScheduler, resetStaleDownloads, startQueueWorker, updateYtdl } from '../utils/downloader';
import { resetStaleMusicDownloads, startMusicQueueWorker, initMusicScheduler } from '../utils/musicDownloader';

export default defineNitroPlugin((nitroApp) => {
  console.log('YouKeep Scheduler Plugin: Initializing background cron jobs...');
  initScheduler();
  initMusicScheduler();

  // Clean up interrupted downloads and start processing immediately on startup
  console.log('YouKeep Scheduler Plugin: Cleaning up stale downloads...');
  try {
    resetStaleDownloads();
    resetStaleMusicDownloads();

    // Check and update yt-dlp asynchronously, then start both queue workers
    updateYtdl()
      .then(() => {
        console.log('YouKeep Scheduler Plugin: yt-dlp check/update completed. Starting queue worker...');
        startQueueWorker();
        startMusicQueueWorker();
      })
      .catch((err) => {
        console.error('YouKeep Scheduler Plugin: yt-dlp auto-update check failed, starting queue anyway:', err);
        startQueueWorker();
        startMusicQueueWorker();
      });
  } catch (err) {
    console.error('Failed to run startup tasks:', err);
  }
});
