import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  // 1. Set global pause setting to '1'
  db.prepare(`
    UPDATE settings 
    SET value = '1' 
    WHERE key = 'downloader_paused'
  `).run();

  // 2. Find currently downloading videos
  const activeDownloads = db.prepare(`
    SELECT id FROM videos 
    WHERE download_status = 'downloading'
  `).all() as { id: string }[];

  // 3. Cancel each active download and reset it to 'pending' so it restarts when resumed
  for (const v of activeDownloads) {
    cancelDownload(v.id, 'pending', true);
  }

  return { success: true };
});
