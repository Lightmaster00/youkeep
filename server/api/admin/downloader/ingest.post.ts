import { defineEventHandler, readBody, createError } from 'h3';
import { ingestUrl, normalizeCustomSavePath, normalizeDateAfter, syncAllChannels } from '../../../utils/downloader';

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
    start_sync,
    channelId,
    name,
    avatarUrl
  } = body;

  if (!url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'URL is required.'
    });
  }

  // A save folder is an absolute path without '..' (empty means none).
  let savePath: string | null | undefined = undefined;
  if (custom_save_path !== undefined && custom_save_path !== null && !(typeof custom_save_path === 'string' && custom_save_path.trim() === '')) {
    savePath = normalizeCustomSavePath(custom_save_path);
    if (!savePath) throw createError({ statusCode: 400, statusMessage: 'The save folder must be an absolute path without "..".' });
  } else if (custom_save_path !== undefined) {
    savePath = null;
  }

  // "Only videos after": YYYY-MM-DD (the date input) or YYYYMMDD, stored as YYYYMMDD.
  if (date_after !== undefined && date_after !== null && date_after !== '' && !normalizeDateAfter(date_after)) {
    throw createError({ statusCode: 400, statusMessage: 'The date must be YYYY-MM-DD.' });
  }

  try {
    const result = await ingestUrl(url, {
      download_videos: download_videos !== undefined ? (download_videos ? 1 : 0) : undefined,
      download_shorts: download_shorts !== undefined ? (download_shorts ? 1 : 0) : undefined,
      download_lives: download_lives !== undefined ? (download_lives ? 1 : 0) : undefined,
      date_after: date_after !== undefined ? (normalizeDateAfter(date_after) ?? null) : undefined,
      sync_status: sync_status !== undefined ? sync_status : undefined,
      visibility: visibility !== undefined ? visibility : undefined,
      custom_save_path: savePath,
      // A channel answers at once; its videos are listed in the background.
      background: true,
      // Optional hints from a search result: skip even the quick channel lookup.
      hints: { channelId, name, avatarUrl },
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
    console.error('[admin/downloader/ingest]', err);
    throw createError({
      statusCode: 500,
      statusMessage: 'An error occurred during ingestion. Check the server logs for details.'
    });
  }
});
