import { defineEventHandler, readBody, createError } from 'h3';
import { ingestPodcastFeed } from '../../../utils/podcastDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { feedUrl, sync_status, visibility } = body;

  if (!feedUrl) {
    throw createError({ statusCode: 400, statusMessage: 'feedUrl is required.' });
  }

  const VALID_VISIBILITIES = ['public', 'private', 'ultra_private'];
  if (visibility !== undefined && !VALID_VISIBILITIES.includes(visibility)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid visibility value: ${visibility}` });
  }

  try {
    const result = await ingestPodcastFeed(feedUrl, {
      sync_status: sync_status !== undefined ? sync_status : undefined,
      visibility: visibility !== undefined ? visibility : undefined,
    });

    if (!result.success) {
      throw createError({ statusCode: 500, statusMessage: result.message });
    }

    return result;
  } catch (err: any) {
    console.error('[admin/podcasts/ingest]', err);
    throw createError({ statusCode: 500, statusMessage: 'An error occurred during podcast ingestion. Check the server logs for details.' });
  }
});
