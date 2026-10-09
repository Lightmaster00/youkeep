import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { initScheduler, resetStaleDownloads, startQueueWorker, updateYtdl, resumeInterruptedChannelImports } from '../utils/downloader';
import { backfillMissingVideoDurations } from '../utils/videoDurations';
import { getDb } from '../utils/db';
import { resetStaleMusicDownloads, startMusicQueueWorker, initMusicScheduler, resumeInterruptedArtistImports } from '../utils/musicDownloader';
import { resetStalePodcastDownloads, startPodcastQueueWorker, initPodcastScheduler } from '../utils/podcastDownloader';
import { scheduleStartupAlbumMatch } from '../utils/albumMatchRunner';

// Fire-and-forget: fills NULL durations of already-downloaded videos via ffprobe.
function runDurationBackfill() {
  backfillMissingVideoDurations(getDb())
    .then((r) => { if (r.checked > 0) console.log(`YouKeep Scheduler Plugin: duration backfill checked ${r.checked}, updated ${r.updated}`); })
    .catch((err) => console.error('YouKeep Scheduler Plugin: duration backfill failed:', err));
}

// Follows whose background listing a restart interrupted are queued again.
function resumeInterruptedImports() {
  for (const resume of [resumeInterruptedArtistImports, resumeInterruptedChannelImports]) {
    try {
      resume();
    } catch (err) {
      console.error('YouKeep Scheduler Plugin: could not resume interrupted imports:', err);
    }
  }
  // Tracks not checked for an album yet (an interrupted run, older downloads) are matched after a short delay.
  try {
    scheduleStartupAlbumMatch();
  } catch (err) {
    console.error('YouKeep Scheduler Plugin: could not schedule album matching:', err);
  }
}

export default defineNitroPlugin((nitroApp) => {
  console.log('YouKeep Scheduler Plugin: Initializing background cron jobs...');
  initScheduler();
  initMusicScheduler();
  initPodcastScheduler();

  // Clean up interrupted downloads and start processing immediately on startup
  console.log('YouKeep Scheduler Plugin: Cleaning up stale downloads...');
  try {
    resetStaleDownloads();
    resetStaleMusicDownloads();
    resetStalePodcastDownloads();

    // Check and update yt-dlp asynchronously, then start all queue workers.
    // Podcasts don't need yt-dlp at all, but starting their queue worker
    // alongside the other two in both branches of this chain keeps startup
    // ordering simple and matches where video/music already start.
    updateYtdl()
      .then(() => {
        console.log('YouKeep Scheduler Plugin: yt-dlp check/update completed. Starting queue worker...');
        startQueueWorker();
        startMusicQueueWorker();
        startPodcastQueueWorker();
        runDurationBackfill();
        resumeInterruptedImports();
      })
      .catch((err) => {
        console.error('YouKeep Scheduler Plugin: yt-dlp auto-update check failed, starting queue anyway:', err);
        startQueueWorker();
        startMusicQueueWorker();
        startPodcastQueueWorker();
        runDurationBackfill();
        resumeInterruptedImports();
      });
  } catch (err) {
    console.error('Failed to run startup tasks:', err);
  }
});
