import { defineEventHandler } from 'h3';
import { readOptionalJsonObject, optionalString } from '../../../utils/validation';
import { runInBackground } from '../../../utils/background';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  // No body: retry every failed download; with an id: just that one.
  const id = optionalString(await readOptionalJsonObject(event), 'episodeId', { max: 200 });

  if (id) {
    db.prepare(`
      UPDATE podcast_episodes
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
      WHERE id = ? AND download_status = 'failed'
    `).run(id);
  } else {
    db.prepare(`
      UPDATE podcast_episodes
      SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
      WHERE download_status = 'failed'
    `).run();
  }

  runInBackground('startPodcastQueueWorker', () => startPodcastQueueWorker());

  return { success: true };
});
