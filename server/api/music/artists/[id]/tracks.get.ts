import { defineEventHandler, createError, getQuery } from 'h3';
import { canAccessMusicArtist } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const db = getDb();

  const artistExists = db.prepare('SELECT id FROM music_artists WHERE id = ?').get(artistId);
  if (!artistExists) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }

  const hasAccess = await canAccessMusicArtist(artistId, event);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this artist.'
    });
  }

  const query = getQuery(event);
  const albumIdParam = query.albumId ? String(query.albumId) : null;

  if (!albumIdParam) {
    throw createError({ statusCode: 400, statusMessage: 'albumId is required (use "none" for tracks without an album).' });
  }

  const limit = Math.min(200, Math.max(1, parseInt(String(query.limit ?? '50'), 10) || 50));
  const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);

  const isStandalone = albumIdParam === 'none';
  const albumClauseSql = isStandalone ? 'album_id IS NULL' : 'album_id = ?';
  const params: any[] = [artistId];
  if (!isStandalone) params.push(albumIdParam);

  const totalRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM music_tracks
    WHERE artist_id = ? AND ${albumClauseSql} AND download_status = 'completed'
  `).get(...params) as { cnt: number };

  // "(track_number IS NULL) ASC" forces NULLs to the end regardless of the
  // primary column's own sort direction — SQLite's default NULL-sorts-first
  // behavior would otherwise put untagged tracks before numbered ones.
  const tracks = db.prepare(`
    SELECT id, title, track_number, genre, language, duration, local_thumbnail_path
    FROM music_tracks
    WHERE artist_id = ? AND ${albumClauseSql} AND download_status = 'completed'
    ORDER BY (track_number IS NULL) ASC, track_number ASC, title ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { tracks, total: totalRow.cnt };
});
