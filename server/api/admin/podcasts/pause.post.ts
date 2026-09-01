import { defineEventHandler } from 'h3';
import { cancelPodcastDownload } from '../../../utils/podcastDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  db.prepare(`
    UPDATE settings
    SET value = '1'
    WHERE key = 'podcast_downloader_paused'
  `).run();

  const activeDownloads = db.prepare(`
    SELECT id FROM podcast_episodes
    WHERE download_status = 'downloading'
  `).all() as { id: string }[];

  for (const e of activeDownloads) {
    cancelPodcastDownload(e.id, 'pending', true);
  }

  return { success: true };
});
