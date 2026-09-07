import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const showId = event.context.params?.id;

  if (!showId) {
    throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
  }

  const result = deletePodcastShow(showId);
  if (!result.success) {
    throw createError({ statusCode: 404, statusMessage: result.error });
  }

  return { success: true };
});
