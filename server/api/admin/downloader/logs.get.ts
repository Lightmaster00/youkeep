import { latestLogs, activeProcesses } from '../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const ytdlPath = await getYtdlPath();
  const db = getDb();
  
  // Get counts
  const pendingCount = (db.prepare("SELECT COUNT(*) as count FROM videos WHERE download_status = 'pending'").get() as any).count;
  const downloadingCount = (db.prepare("SELECT COUNT(*) as count FROM videos WHERE download_status = 'downloading'").get() as any).count;
  const completedCount = (db.prepare("SELECT COUNT(*) as count FROM videos WHERE download_status = 'completed'").get() as any).count;
  const failedCount = (db.prepare("SELECT COUNT(*) as count FROM videos WHERE download_status = 'failed'").get() as any).count;

  // Check global paused
  const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
  const isPaused = pausedSetting?.value === '1';

  return {
    logs: latestLogs,
    ytdlPath,
    isPaused,
    activeDownloadCount: activeProcesses.size,
    stats: {
      pending: pendingCount,
      downloading: downloadingCount,
      completed: completedCount,
      failed: failedCount
    }
  };
});
