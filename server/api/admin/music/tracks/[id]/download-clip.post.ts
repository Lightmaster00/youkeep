import { defineEventHandler, createError } from 'h3';
import { requireAdmin } from '../../../../../utils/auth';
import { downloadTrackClip } from '../../../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const trackId = event.context.params?.id;

  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const db = getDb();
  const track = db.prepare('SELECT id, has_clip FROM music_tracks WHERE id = ?').get(trackId) as { id: string; has_clip: number } | undefined;
  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
  }
  if (track.has_clip === 1) {
    throw createError({ statusCode: 409, statusMessage: 'Track already has a clip.' });
  }

  // Fire-and-forget: this is ingestion, not a synchronous action — the client
  // polls the track's has_clip field afterward rather than waiting on this request.
  downloadTrackClip(trackId).catch(() => {});

  return { success: true, queued: true };
});
