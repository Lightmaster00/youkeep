import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const trackId = event.context.params?.id;
  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(trackId);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
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

  if (Object.prototype.hasOwnProperty.call(body, 'genre')) {
    const genre = typeof body.genre === 'string' ? body.genre.trim() : '';
    setClauses.push('genre = ?');
    params.push(genre || null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'language')) {
    const language = typeof body.language === 'string' ? body.language.trim() : '';
    setClauses.push('language = ?');
    params.push(language || null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'trackNumber')) {
    const raw = body.trackNumber;
    let trackNumber: number | null = null;
    if (raw !== '' && raw !== null && raw !== undefined) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'trackNumber must be a positive integer.' });
      }
      trackNumber = parsed;
    }
    setClauses.push('track_number = ?');
    params.push(trackNumber);
  }

  if (setClauses.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No fields to update.' });
  }

  params.push(trackId);
  db.prepare(`UPDATE music_tracks SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT id, title, track_number, genre, language FROM music_tracks WHERE id = ?').get(trackId);

  return { track: updated };
});
