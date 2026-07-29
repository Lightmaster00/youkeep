import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const albumId = event.context.params?.id;
  if (!albumId) {
    throw createError({ statusCode: 400, statusMessage: 'Album ID is required.' });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM music_albums WHERE id = ?').get(albumId);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Album not found.' });
  }

  const body = await readBody(event);

  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Request body must be a JSON object.' });
  }

  const setClauses: string[] = [];
  const params: any[] = [];

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw createError({ statusCode: 400, statusMessage: 'Title cannot be empty.' });
    }
    setClauses.push('title = ?');
    params.push(title);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'releaseYear')) {
    const raw = body.releaseYear;
    let releaseYear: number | null = null;
    if (raw !== '' && raw !== null && raw !== undefined) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
        throw createError({ statusCode: 400, statusMessage: 'releaseYear must be an integer between 1900 and 2100.' });
      }
      releaseYear = parsed;
    }
    setClauses.push('release_year = ?');
    params.push(releaseYear);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'coverUrl')) {
    const coverUrl = typeof body.coverUrl === 'string' ? body.coverUrl.trim() : '';
    setClauses.push('cover_url = ?');
    params.push(coverUrl || null);
  }

  if (setClauses.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No fields to update.' });
  }

  params.push(albumId);
  db.prepare(`UPDATE music_albums SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare(`
    SELECT
      al.id,
      al.title,
      al.release_year,
      al.cover_url as manual_cover_url,
      COALESCE(
        al.cover_url,
        (
          SELECT t2.local_thumbnail_path
          FROM music_tracks t2
          WHERE t2.album_id = al.id AND t2.download_status = 'completed'
          ORDER BY t2.track_number ASC, t2.created_at ASC
          LIMIT 1
        )
      ) as cover_url
    FROM music_albums al
    WHERE al.id = ?
  `).get(albumId);

  return { album: updated };
});
