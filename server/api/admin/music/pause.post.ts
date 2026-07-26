import { defineEventHandler } from 'h3';
import { cancelMusicDownload } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  db.prepare(`
    UPDATE settings
    SET value = '1'
    WHERE key = 'music_downloader_paused'
  `).run();

  const activeDownloads = db.prepare(`
    SELECT id FROM music_tracks
    WHERE download_status = 'downloading'
  `).all() as { id: string }[];

  for (const t of activeDownloads) {
    cancelMusicDownload(t.id, 'pending', true);
  }

  return { success: true };
});
