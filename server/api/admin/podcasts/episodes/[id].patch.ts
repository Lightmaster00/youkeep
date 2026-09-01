import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../../utils/auth';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const episodeId = event.context.params?.id;
  if (!episodeId) {
    throw createError({ statusCode: 400, statusMessage: 'Episode ID is required.' });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM podcast_episodes WHERE id = ?').get(episodeId);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found.' });
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

  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    setClauses.push('description = ?');
    params.push(description || null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'episodeNumber')) {
    const raw = body.episodeNumber;
    let episodeNumber: number | null = null;
    if (raw !== '' && raw !== null && raw !== undefined) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'episodeNumber must be a positive integer.' });
      }
      episodeNumber = parsed;
    }
    setClauses.push('episode_number = ?');
    params.push(episodeNumber);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'seasonNumber')) {
    const raw = body.seasonNumber;
    let seasonNumber: number | null = null;
    if (raw !== '' && raw !== null && raw !== undefined) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'seasonNumber must be a positive integer.' });
      }
      seasonNumber = parsed;
    }
    setClauses.push('season_number = ?');
    params.push(seasonNumber);
  }

  if (setClauses.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No fields to update.' });
  }

  params.push(episodeId);
  db.prepare(`UPDATE podcast_episodes SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT id, title, description, episode_number, season_number FROM podcast_episodes WHERE id = ?').get(episodeId);

  return { episode: updated };
});
