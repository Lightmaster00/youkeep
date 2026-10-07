import { defineEventHandler, createError } from 'h3';
import { cancelMusicDownload } from '../../../../../utils/musicDownloader';
import { CANCELLED_BY_ADMIN_MESSAGE } from '../../../../../utils/downloader';

/**
 * Cancels a queued or running track download. Same semantics as the video
 * cancel route: the track is marked failed ("Cancelled by an admin."), so the
 * music queue worker does not pick it up again; it is downloaded again only
 * when the admin retries it (Retry failed). A completed track is never
 * touched (its files are not partial files).
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const trackId = event.context.params?.id;

  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const db = getDb();
  const track = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get(trackId) as { download_status: string } | undefined;
  if (!track || (track.download_status !== 'downloading' && track.download_status !== 'pending')) {
    // Nothing queued to cancel (already failed, completed or unknown).
    return { success: track?.download_status === 'failed' };
  }

  cancelMusicDownload(trackId, 'failed');
  db.prepare('UPDATE music_tracks SET last_error = ? WHERE id = ?').run(CANCELLED_BY_ADMIN_MESSAGE, trackId);
  return { success: true };
});
