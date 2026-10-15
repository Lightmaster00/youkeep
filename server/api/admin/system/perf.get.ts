import { defineEventHandler } from 'h3';
import { getLoopMonitor } from '../../../utils/loopMonitor';

// Server responsiveness (Settings > System > Tools & logs): event-loop delay
// now and over the last 15 minutes, and how many downloads are running.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  const activeDownloads = (db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM videos WHERE download_status = 'downloading') +
      (SELECT COUNT(*) FROM music_tracks WHERE download_status = 'downloading') +
      (SELECT COUNT(*) FROM podcast_episodes WHERE download_status = 'downloading') AS n
  `).get() as { n: number }).n;
  return { ...getLoopMonitor().summary(), activeDownloads };
});
