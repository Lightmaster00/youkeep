import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { initScheduler, resetStaleDownloads, startQueueWorker, updateYtdl } from '../utils/downloader';

export default defineNitroPlugin((nitroApp) => {
  console.log('YouKeep Scheduler Plugin: Initializing background cron jobs...');
  initScheduler();
  
  // Clean up interrupted downloads and start processing immediately on startup
  console.log('YouKeep Scheduler Plugin: Cleaning up stale downloads...');
  try {
    resetStaleDownloads();
    
    // Check and update yt-dlp asynchronously, then start the queue worker
    updateYtdl()
      .then(() => {
        console.log('YouKeep Scheduler Plugin: yt-dlp check/update completed. Starting queue worker...');
        startQueueWorker();
      })
      .catch((err) => {
        console.error('YouKeep Scheduler Plugin: yt-dlp auto-update check failed, starting queue anyway:', err);
        startQueueWorker();
      });
  } catch (err) {
    console.error('Failed to run startup tasks:', err);
  }
});
