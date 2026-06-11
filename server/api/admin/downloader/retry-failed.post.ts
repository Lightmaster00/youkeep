import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  const body = await readBody(event);

  if (body?.videoId) {
    // Retry a single video
    db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL
      WHERE id = ? AND download_status = 'failed'
    `).run(body.videoId);
  } else {
    // Retry all failed downloads
    db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL
      WHERE download_status = 'failed'
    `).run();
  }

  // Trigger queue processing
  startQueueWorker();

  return { success: true };
});
