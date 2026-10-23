import { defineEventHandler, createError } from 'h3';
import { requireSessionAdmin } from '../../../../utils/auth';
import { startMetadataBackfill } from '../../../../utils/metadataBackfill';

// Starts the lookup in the background; the request never waits for yt-dlp.
export default defineEventHandler(async (event) => {
  await requireSessionAdmin(event);
  const result = startMetadataBackfill(getDb());
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }
  return result;
});
