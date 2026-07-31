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
  const albumClauseSqlAliased = isStandalone ? 't.album_id IS NULL' : 't.album_id = ?';
  const params: any[] = [artistId];
  if (!isStandalone) params.push(albumIdParam);

  const totalRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM music_tracks
    WHERE artist_id = ? AND ${albumClauseSql} AND download_status = 'completed'
  `).get(...params) as { cnt: number };

  // "(t.track_number IS NULL) ASC" forces NULLs to the end regardless of the
  // primary column's own sort direction — SQLite's default NULL-sorts-first
  // behavior would otherwise put untagged tracks before numbered ones.
  //
  // Joins music_artists to include local_file_path/artist_name: the audio
  // player (sub-project 4) needs local_file_path to actually play a track
  // and artist_name to display it in the mini-player — this endpoint
  // predates the player and originally selected neither.
  const tracks = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.artist_id = ? AND ${albumClauseSqlAliased} AND t.download_status = 'completed'
    ORDER BY (t.track_number IS NULL) ASC, t.track_number ASC, t.title ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { tracks, total: totalRow.cnt };
});
