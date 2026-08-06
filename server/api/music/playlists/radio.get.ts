import { defineEventHandler, getQuery, createError } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { musicVisibilityClause } from '../../../utils/musicVisibility';

const RADIO_TOTAL = 30;
const RADIO_SAME_ARTIST_MAX = 8;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const trackId = query.trackId ? String(query.trackId) : null;
  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'trackId is required.' });
  }

  const session = await getUserFromSession(event);
  const db = getDb();

  const seed = db.prepare(`SELECT artist_id, genre FROM music_tracks WHERE id = ?`).get(trackId) as { artist_id: string; genre: string | null } | undefined;
  if (!seed) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
  }

  const clause = musicVisibilityClause(session);
  const visClause = clause ? `AND ${clause}` : '';

  const sameArtistLimit = seed.genre ? RADIO_SAME_ARTIST_MAX : RADIO_TOTAL;
  const allSameArtistRows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' AND t.artist_id = ? AND t.id != ? ${visClause}
    ORDER BY RANDOM()
  `).all(seed.artist_id, trackId) as any[];

  const sameArtistRows = allSameArtistRows.slice(0, sameArtistLimit);

  let combined = sameArtistRows;

  if (seed.genre) {
    const remaining = RADIO_TOTAL - sameArtistRows.length;
    const excludeIds = [trackId, ...allSameArtistRows.map((r) => r.id)];
    const placeholders = excludeIds.map(() => '?').join(',');
    const allSameGenreRows = db.prepare(`
      SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
             t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
      FROM music_tracks t
      JOIN music_artists a ON t.artist_id = a.id
      WHERE t.download_status = 'completed' AND t.genre = ? AND t.id NOT IN (${placeholders}) ${visClause}
      ORDER BY RANDOM()
    `).all(seed.genre, ...excludeIds) as any[];

    const sameGenreRows = allSameGenreRows.slice(0, remaining);
    combined = [...sameArtistRows, ...sameGenreRows];
    // Shuffle in JS so same-artist and same-genre tracks are interleaved,
    // not grouped — the SQL above necessarily returns them as two blocks.
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
  }

  return { tracks: combined };
});
