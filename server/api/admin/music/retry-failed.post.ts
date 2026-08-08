import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  const body = await readBody(event);

  if (body?.trackId) {
    // Retry a single track
    db.prepare(`
      UPDATE music_tracks
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
      WHERE id = ? AND download_status = 'failed'
    `).run(body.trackId);
  } else {
    // Retry all failed downloads
    db.prepare(`
      UPDATE music_tracks
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
      WHERE download_status = 'failed'
    `).run();
  }

  // Trigger queue processing
  startMusicQueueWorker();

  return { success: true };
});
