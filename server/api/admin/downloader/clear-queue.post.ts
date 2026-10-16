import { defineEventHandler } from 'h3';
import { activeProcesses, cancelDownload } from '../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  // 1. Every row about to be deleted that may own a process or partial files:
  // running downloads (and anything with a live process), failed ones, and
  // paused ones that already have progress (their partial files wait for resume).
  const activeIds = [...activeProcesses.keys()];
  const activeOrFailed = db.prepare(`
    SELECT id FROM videos
    WHERE download_status IN ('downloading', 'failed')
       OR (download_status = 'pending' AND download_progress > 0)
       OR (download_status != 'completed' AND id IN (SELECT value FROM json_each(?)))
  `).all(JSON.stringify(activeIds)) as { id: string }[];

  // 2. Terminate active processes and delete temporary files only for these videos
  for (const v of activeOrFailed) {
    cancelDownload(v.id, 'failed');
  }

  // 3. Remove non-completed videos from DB
  db.prepare(`
    DELETE FROM videos 
    WHERE download_status IN ('downloading', 'pending', 'failed')
  `).run();

  return { success: true };
});
