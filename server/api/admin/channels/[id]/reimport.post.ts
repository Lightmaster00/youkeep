import { defineEventHandler, createError } from 'h3';
import { startChannelImport } from '../../../../utils/downloader';

/** Runs a channel's video listing again in the background (Retry after a failed import). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  if (!startChannelImport(channelId)) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }
  return { success: true, importing: true };
});
