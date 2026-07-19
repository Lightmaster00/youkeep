import { defineEventHandler } from 'h3';
import { syncChannelPlaylists } from '../../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel ID is required.'
    });
  }

  // Trigger sync asynchronously
  syncChannelPlaylists(channelId).catch(err => {
    console.error(`Error during background playlists sync for channel ${channelId}:`, err);
  });

  return { success: true, message: 'La synchronisation des playlists a démarré.' };
});
