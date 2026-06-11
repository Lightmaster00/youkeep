import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const videoId = event.context.params?.id;
  const body = await readBody(event);
  const { visibility } = body || {};

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'ID de vidéo requis.' });
  }

  if (!visibility || !['public', 'private', 'ultra_private'].includes(visibility)) {
    throw createError({ statusCode: 400, statusMessage: 'Niveau de visibilité invalide.' });
  }

  const db = getDb();
  db.prepare('UPDATE videos SET visibility = ? WHERE id = ?').run(visibility, videoId);

  return { success: true };
});
