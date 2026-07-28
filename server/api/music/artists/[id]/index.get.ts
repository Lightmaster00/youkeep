import { defineEventHandler, createError } from 'h3';
import { canAccessMusicArtist } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const db = getDb();

  const artist = db.prepare(`
    SELECT id, name, description, avatar_url, banner_url, visibility
    FROM music_artists
    WHERE id = ?
  `).get(artistId);

  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }

  const hasAccess = await canAccessMusicArtist(artistId, event);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this artist.'
    });
  }

  // SQLite sorts NULLs first in ascending order, which means they sort last
  // in descending order — so plain "DESC" here already puts unknown release
  // years at the end without a separate CASE expression.
  const albums = db.prepare(`
    SELECT
      al.id,
      al.title,
      al.release_year,
      COUNT(t.id) as track_count,
      (
        SELECT t2.local_thumbnail_path
        FROM music_tracks t2
        WHERE t2.album_id = al.id AND t2.download_status = 'completed'
        ORDER BY t2.track_number ASC, t2.created_at ASC
        LIMIT 1
      ) as cover_url
    FROM music_albums al
    JOIN music_tracks t ON t.album_id = al.id AND t.download_status = 'completed'
    WHERE al.artist_id = ?
    GROUP BY al.id
    ORDER BY al.release_year DESC, al.title ASC
  `).all(artistId);

  const standaloneRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM music_tracks
    WHERE artist_id = ? AND album_id IS NULL AND download_status = 'completed'
  `).get(artistId) as { cnt: number };

  return {
    artist,
    albums,
    standaloneTrackCount: standaloneRow.cnt
  };
});
