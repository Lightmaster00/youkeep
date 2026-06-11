import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { videoId } = body;

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID is required.' });
  }

  const success = cancelDownload(videoId);
  return { success };
});
