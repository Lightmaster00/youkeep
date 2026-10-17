import { defineEventHandler } from 'h3';
import { startPodcastQueueWorker } from '../../../utils/podcastDownloader';
import { runInBackground } from '../../../utils/background';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  db.prepare(`
    UPDATE settings
    SET value = '0'
    WHERE key = 'podcast_downloader_paused'
  `).run();

  runInBackground('startPodcastQueueWorker', () => startPodcastQueueWorker());

  return { success: true };
});
