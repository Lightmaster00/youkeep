import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  try {
    const output = await updateYtdl();
    return { success: true, output };
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'Failed to update yt-dlp.'
    });
  }
});
