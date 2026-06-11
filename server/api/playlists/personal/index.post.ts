import { defineEventHandler, createError, readBody } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const body = await readBody(event);

  if (!body.title || typeof body.title !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Title is required and must be a string.'
    });
  }

  const db = getDb();
  const playlistId = crypto.randomUUID();
  const shareToken = crypto.randomBytes(16).toString('hex');
  const visibility = body.visibility || 'private';

  if (!['public', 'unlisted', 'private'].includes(visibility)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid visibility value.'
    });
  }

  db.prepare(`
    INSERT INTO personal_playlists (id, title, description, user_id, visibility, share_token, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    playlistId,
    body.title.trim(),
    body.description ? body.description.trim() : null,
    user.id,
    visibility,
    shareToken,
    Date.now()
  );

  const playlist = db.prepare('SELECT * FROM personal_playlists WHERE id = ?').get(playlistId);

  return { playlist };
});
