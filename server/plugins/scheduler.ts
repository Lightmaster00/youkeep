import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { initScheduler, resetStaleDownloads, startQueueWorker, updateYtdl, resumeInterruptedChannelImports } from '../utils/downloader';
import { backfillMissingVideoDurations, backfillMissingVideoSizes } from '../utils/videoDurations';
import { getDb } from '../utils/db';
import { resetStaleMusicDownloads, startMusicQueueWorker, initMusicScheduler, resumeInterruptedArtistImports } from '../utils/musicDownloader';
import { resetStalePodcastDownloads, startPodcastQueueWorker, initPodcastScheduler } from '../utils/podcastDownloader';
import { scheduleStartupAlbumMatch } from '../utils/albumMatchRunner';
import { startThumbCacheSweep, sweepThumbCache } from '../utils/thumbnails';
import { startAfterUpdate } from '../utils/startup';
import { resetSyncAllFlags } from '../utils/concurrency';
import { runInBackground } from '../utils/background';

// Fire-and-forget: fills NULL durations of already-downloaded videos via ffprobe.
function runDurationBackfill() {
  backfillMissingVideoDurations(getDb())
    .then((r) => { if (r.checked > 0) console.log(`YouKeep Scheduler Plugin: duration backfill checked ${r.checked}, updated ${r.updated}`); })
    .catch((err) => console.error('YouKeep Scheduler Plugin: duration backfill failed:', err));
}

// Fire-and-forget: fills NULL file sizes of already-downloaded videos from their stored file.
function runSizeBackfill() {
  backfillMissingVideoSizes(getDb())
    .then((r) => { if (r.updated > 0) console.log(`YouKeep Scheduler Plugin: size backfill checked ${r.checked}, updated ${r.updated}`); })
    .catch((err) => console.error('YouKeep Scheduler Plugin: size backfill failed:', err));
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
  // Resized thumbnails nobody asked for in 90 days (they are regenerated on demand).
  try {
    const removed = sweepThumbCache();
    if (removed > 0) console.log(`YouKeep Scheduler Plugin: removed ${removed} old cached thumbnail(s).`);
  } catch (err) {
    console.error('YouKeep Scheduler Plugin: thumbnail cache sweep failed:', err);
  }
  // ...and again every day while the server runs.
  nitroApp.hooks.hook('close', startThumbCacheSweep());

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
    // A restart during a sync-all must not leave it "running" forever.
    resetSyncAllFlags(getDb());

    // Check and update yt-dlp in the background; the queue workers start when
    // it settles, or after a guard delay if it hangs (never blocked by it).
    // Podcasts don't need yt-dlp, but starting all three together keeps
    // startup ordering simple.
    startAfterUpdate(updateYtdl, () => {
      runInBackground('startQueueWorker', () => startQueueWorker());
      runInBackground('startMusicQueueWorker', () => startMusicQueueWorker());
      runInBackground('startPodcastQueueWorker', () => startPodcastQueueWorker());
      runDurationBackfill();
      runSizeBackfill();
      resumeInterruptedImports();
    });
  } catch (err) {
    console.error('Failed to run startup tasks:', err);
  }
});
