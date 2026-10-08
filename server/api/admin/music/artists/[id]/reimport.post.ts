import { defineEventHandler, createError } from 'h3';
import { startArtistImport } from '../../../../../utils/musicDownloader';

/** Runs an artist's track listing again in the background (Retry after a failed import). */
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
    throw createError({ statusCode: 400, statusMessage: 'This artist has no followed channel to import.' });
  }

  startArtistImport(artistId);
  return { success: true, importing: true };
});
