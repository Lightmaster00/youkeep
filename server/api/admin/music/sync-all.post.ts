import { defineEventHandler } from 'h3';
import { syncAllMusicArtists } from '../../../utils/musicDownloader';

// Mirrors /api/admin/downloader/sync-all for music: re-checks every followed artist.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const flag = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_all_active'").get() as { value: string } | undefined;
  if (flag?.value === '1') {
    return { success: false, message: 'A music sync is already running.' };
  }

  // Fire and forget, like the video route; syncAllMusicArtists logs its own errors.
  syncAllMusicArtists().catch((err) => console.error('[admin/music/sync-all]', err));

  return { success: true, message: 'Sync started for every followed artist.' };
});
