import { defineEventHandler, createError } from 'h3';
import { ingestPodcastFeed, startPodcastQueueWorker } from '../../../../../utils/podcastDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const showId = event.context.params?.id;

  if (!showId) {
    throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
  }

  const db = getDb();
  const show = db.prepare('SELECT feed_url FROM podcast_shows WHERE id = ?').get(showId) as { feed_url: string } | undefined;

  if (!show) {
    throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
  }

  const res = db.prepare(`
    UPDATE podcast_shows
    SET sync_status = 'downloading'
    WHERE id = ?
  `).run(showId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
  }

  setTimeout(async () => {
    try {
      console.log(`Starting background podcast ingestion for show ${showId} triggered by manual sync start`);
      await ingestPodcastFeed(show.feed_url);
    } catch (err) {
      console.error(`Failed background podcast ingestion for show ${showId}:`, err);
    }
  }, 100);

  startPodcastQueueWorker();

  return { success: true };
});
