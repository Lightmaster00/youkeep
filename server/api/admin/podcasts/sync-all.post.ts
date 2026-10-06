import { defineEventHandler } from 'h3';
import { syncAllPodcastShows } from '../../../utils/podcastDownloader';

// Mirrors /api/admin/downloader/sync-all for podcasts: re-checks every followed show.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const flag = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_all_active'").get() as { value: string } | undefined;
  if (flag?.value === '1') {
    return { success: false, message: 'A podcast sync is already running.' };
  }

  syncAllPodcastShows().catch((err) => console.error('[admin/podcasts/sync-all]', err));

  return { success: true, message: 'Sync started for every followed podcast.' };
});
