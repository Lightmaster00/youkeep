import { defineEventHandler, readBody, createError } from 'h3';
import { canAccessMusicTrack } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (!body || typeof body !== 'object' || !Array.isArray(body.ids)) {
    throw createError({ statusCode: 400, statusMessage: 'ids array is required.' });
  }

  const ids: string[] = body.ids.filter((id: any) => typeof id === 'string').slice(0, 200);
  if (ids.length === 0) {
    return { tracks: [] };
  }

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.id IN (${placeholders}) AND t.download_status = 'completed'
  `).all(...ids) as any[];

  const accessible: any[] = [];
  for (const row of rows) {
    if (await canAccessMusicTrack(row.id, event)) {
      accessible.push(row);
    }
  }

  // Preserve the caller's requested order — the queue restored from
  // localStorage needs to match the order it was saved in, not whatever
  // order SQLite's IN clause happened to return.
  const byId = new Map(accessible.map((r) => [r.id, r]));
  const tracks = ids.map((id) => byId.get(id)).filter(Boolean);

  return { tracks };
});
