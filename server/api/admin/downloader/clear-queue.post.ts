import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  // 1. Find only downloading or failed videos to terminate and clean up
  const activeOrFailed = db.prepare(`
    SELECT id FROM videos 
    WHERE download_status IN ('downloading', 'failed')
  `).all() as { id: string }[];

  // 2. Terminate active processes and delete temporary files only for these videos
  for (const v of activeOrFailed) {
    cancelDownload(v.id);
  }

  // 3. Remove non-completed videos from DB
  db.prepare(`
    DELETE FROM videos 
    WHERE download_status IN ('downloading', 'pending', 'failed')
  `).run();

  return { success: true };
});
