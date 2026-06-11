import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { 
    url,
    download_videos,
    download_shorts,
    download_lives,
    date_after,
    sync_status,
    visibility,
    custom_save_path,
    start_sync
  } = body;

  if (!url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'URL is required.'
    });
  }

  try {
    const result = await ingestUrl(url, {
      download_videos: download_videos !== undefined ? (download_videos ? 1 : 0) : undefined,
      download_shorts: download_shorts !== undefined ? (download_shorts ? 1 : 0) : undefined,
      download_lives: download_lives !== undefined ? (download_lives ? 1 : 0) : undefined,
      date_after: date_after !== undefined ? date_after : undefined,
      sync_status: sync_status !== undefined ? sync_status : undefined,
      visibility: visibility !== undefined ? visibility : undefined,
      custom_save_path: custom_save_path !== undefined ? custom_save_path : undefined
    });

    if (!result.success) {
      throw createError({
        statusCode: 500,
        statusMessage: result.message
      });
    }

    if (start_sync) {
      // Trigger background sync worker asynchronously
      syncAllChannels();
    }

    return result;
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'An error occurred during ingestion.'
    });
  }
});
