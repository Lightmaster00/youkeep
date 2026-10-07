import { defineEventHandler, readBody, createError } from 'h3';
import { CANCELLED_BY_ADMIN_MESSAGE } from '../../../utils/downloader';

/**
 * Cancels a queued or running video download. The video is marked failed
 * ("Cancelled by an admin."), so the queue worker does not pick it up again:
 * it is downloaded again only when the admin retries it (Retry failed).
 * A completed video is never touched (its files are not partial files).
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { videoId } = body;

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID is required.' });
  }

  const db = getDb();
  const video = db.prepare('SELECT download_status FROM videos WHERE id = ?').get(videoId) as { download_status: string } | undefined;
  if (!video || (video.download_status !== 'downloading' && video.download_status !== 'pending')) {
    // Nothing queued to cancel (already failed, completed or unknown).
    return { success: video?.download_status === 'failed' };
  }

  cancelDownload(videoId, 'failed');
  db.prepare('UPDATE videos SET last_error = ?, is_manually_queued = 0 WHERE id = ?').run(CANCELLED_BY_ADMIN_MESSAGE, videoId);
  return { success: true };
});
