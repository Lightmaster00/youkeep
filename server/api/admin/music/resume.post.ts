import { defineEventHandler } from 'h3';
import { startMusicQueueWorker } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  db.prepare(`
    UPDATE settings
    SET value = '0'
    WHERE key = 'music_downloader_paused'
  `).run();

  startMusicQueueWorker();

  return { success: true };
});
