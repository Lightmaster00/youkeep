import { defineEventHandler, createError } from 'h3';
import { cancelMusicDownload } from '../../../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const trackId = event.context.params?.id;

  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const success = cancelMusicDownload(trackId);
  return { success };
});
