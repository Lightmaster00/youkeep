import { defineEventHandler, readBody, createError } from 'h3';
import { ingestMusicUrl } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { url, sync_status, visibility, channelId, name, avatarUrl } = body;

  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'URL is required.' });
  }

  const VALID_VISIBILITIES = ['public', 'private', 'ultra_private'];
  if (visibility !== undefined && !VALID_VISIBILITIES.includes(visibility)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid visibility value: ${visibility}` });
  }

  try {
    const result = await ingestMusicUrl(url, {
      sync_status: sync_status !== undefined ? sync_status : undefined,
      visibility: visibility !== undefined ? visibility : undefined,
      // Optional hints from a search result: with them the artist is created
      // at once and its tracks are listed in the background.
      hints: { channelId, name, avatarUrl },
    });

    if (!result.success) {
      throw createError({ statusCode: 500, statusMessage: result.message });
    }

    return result;
  } catch (err: any) {
    console.error('[admin/music/ingest]', err);
    throw createError({ statusCode: 500, statusMessage: 'An error occurred during music ingestion. Check the server logs for details.' });
  }
});
