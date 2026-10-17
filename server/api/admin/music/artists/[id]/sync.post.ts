import { defineEventHandler, createError } from 'h3';
import { startArtistImport, startMusicQueueWorker } from '../../../../../utils/musicDownloader';
import { runInBackground } from '../../../../../utils/background';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const db = getDb();
  const artist = db.prepare('SELECT channel_id FROM music_artists WHERE id = ?').get(artistId) as { channel_id: string | null } | undefined;

  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }
  if (!artist.channel_id) {
    throw createError({ statusCode: 400, statusMessage: 'This artist has no followed channel to sync (feat-only artist).' });
  }

  const res = db.prepare(`
    UPDATE music_artists
    SET sync_status = 'downloading'
    WHERE id = ?
  `).run(artistId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }

  // The channel listing runs in the background import queue (the artist shows "Importing…").
  startArtistImport(artistId);
  runInBackground('startMusicQueueWorker', () => startMusicQueueWorker());

  return { success: true };
});
