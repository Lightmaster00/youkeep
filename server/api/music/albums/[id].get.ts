import { defineEventHandler, createError } from 'h3';
import { canAccessMusicArtist } from '../../../utils/auth';
import { getAlbumWithTracks } from '../../../utils/musicArtistPage';

// Album page: the album, its artist and its completed tracks in album order.
// Access follows the album's artist.
export default defineEventHandler(async (event) => {
  const albumId = event.context.params?.id;
  if (!albumId) {
    throw createError({ statusCode: 400, statusMessage: 'Album ID is required.' });
  }
  const db = getDb();
  const result = getAlbumWithTracks(db, albumId);
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Album not found.' });
  }
  if (!(await canAccessMusicArtist(result.album.artistId, event))) {
    // Hidden from this viewer: same answer as a missing album.
    throw createError({ statusCode: 404, statusMessage: 'Album not found.' });
  }
  return result;
});
