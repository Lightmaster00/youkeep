import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const videoId = event.context.params?.id;
  const body = await readBody(event);
  const { visibility } = body || {};

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'A video ID is required.' });
  }

  if (!visibility || !['public', 'private', 'ultra_private'].includes(visibility)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid visibility level.' });
  }

  const db = getDb();
  db.prepare('UPDATE videos SET visibility = ? WHERE id = ?').run(visibility, videoId);

  return { success: true };
});
