import { defineEventHandler } from 'h3';
import { runInBackground } from '../../../utils/background';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  // 1. Set global pause setting to '0'
  db.prepare(`
    UPDATE settings 
    SET value = '0' 
    WHERE key = 'downloader_paused'
  `).run();

  // 2. Trigger queue processing
  runInBackground('startQueueWorker', () => startQueueWorker());

  return { success: true };
});
