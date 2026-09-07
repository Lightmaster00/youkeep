import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const result = deleteMusicArtist(artistId);
  if (!result.success) {
    throw createError({ statusCode: 404, statusMessage: result.error });
  }

  return { success: true };
});
