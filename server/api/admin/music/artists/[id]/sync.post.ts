import { defineEventHandler, createError } from 'h3';
import { ingestMusicUrl, startMusicQueueWorker } from '../../../../../utils/musicDownloader';

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

  const url = `https://www.youtube.com/channel/${artist.channel_id}`;
  setTimeout(async () => {
    try {
      console.log(`Starting background music ingestion for artist ${artistId} triggered by manual sync start`);
      await ingestMusicUrl(url);
    } catch (err) {
      console.error(`Failed background music ingestion for artist ${artistId}:`, err);
    }
  }, 100);

  startMusicQueueWorker();

  return { success: true };
});
