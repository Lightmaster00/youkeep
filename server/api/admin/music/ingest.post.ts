import { defineEventHandler, readBody, createError } from 'h3';
import { ingestMusicUrl } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { url, sync_status, visibility } = body;

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
    });

    if (!result.success) {
      throw createError({ statusCode: 500, statusMessage: result.message });
    }

    return result;
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err.message || 'An error occurred during music ingestion.' });
  }
});
