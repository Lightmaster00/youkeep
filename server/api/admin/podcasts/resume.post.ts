import { defineEventHandler } from 'h3';
import { startPodcastQueueWorker } from '../../../utils/podcastDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  db.prepare(`
    UPDATE settings
    SET value = '0'
    WHERE key = 'podcast_downloader_paused'
  `).run();

  startPodcastQueueWorker();

  return { success: true };
});
