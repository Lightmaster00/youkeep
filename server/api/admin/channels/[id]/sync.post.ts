import { defineEventHandler, createError } from 'h3';
import { startChannelImport, startQueueWorker } from '../../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();
  const res = db.prepare(`
    UPDATE channels 
    SET sync_status = 'downloading'
    WHERE id = ?
  `).run(channelId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  // The channel's tabs are listed in the background import queue (the channel shows "Importing…").
  startChannelImport(channelId);

  // Wakes up queue worker to process any pending downloads for this channel
  startQueueWorker();

  return { success: true };
});
