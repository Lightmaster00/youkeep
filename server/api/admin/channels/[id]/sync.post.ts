import { defineEventHandler, createError } from 'h3';

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

  // Start the channel ingestion asynchronously in the background to fetch new videos
  const url = `https://www.youtube.com/channel/${channelId}`;
  setTimeout(async () => {
    try {
      console.log(`Starting background ingestion for channel ${channelId} triggered by manual sync start`);
      await ingestUrl(url);
    } catch (err) {
      console.error(`Failed background ingestion for channel ${channelId}:`, err);
    }
  }, 100);

  // Wakes up queue worker to process any pending downloads for this channel
  startQueueWorker();

  return { success: true };
});
