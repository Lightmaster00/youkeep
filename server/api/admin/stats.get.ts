import { defineEventHandler } from 'h3';
import fs from 'fs';
import path from 'path';

function getFolderSize(dirPath: string): number {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;

  const items = fs.readdirSync(dirPath);
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stats = fs.statSync(itemPath);
    if (stats.isDirectory()) {
      totalSize += getFolderSize(itemPath);
    } else {
      totalSize += stats.size;
    }
  }
  return totalSize;
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const totalVideos = (db.prepare("SELECT COUNT(*) as count FROM videos WHERE download_status = 'completed'").get() as any).count;
  const totalQueue = (db.prepare("SELECT COUNT(*) as count FROM videos WHERE download_status IN ('pending', 'downloading')").get() as any).count;
  const totalChannels = (db.prepare("SELECT COUNT(*) as count FROM channels").get() as any).count;
  // Database size
  const dbPath = path.resolve(process.cwd(), 'data/myteub.db');
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

  // Library-wide aggregate stats (instead of traversing files recursively)
  const libraryAgg = db.prepare(`
    SELECT 
      SUM(duration) as totalDuration,
      SUM(view_count) as totalViews,
      SUM(size_bytes) as totalSize
    FROM videos 
    WHERE download_status = 'completed'
  `).get() as any;

  const mediaSize = libraryAgg.totalSize || 0;
  const totalDuration = libraryAgg.totalDuration || 0;
  const totalViews = libraryAgg.totalViews || 0;

  const totalComments = (db.prepare("SELECT COUNT(*) as count FROM comments").get() as any).count;

  return {
    totalVideos,
    totalQueue,
    totalChannels,
    dbSize,
    mediaSize,
    totalDuration,
    totalViews,
    totalComments
  };
});
