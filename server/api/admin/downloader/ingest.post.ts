import { defineEventHandler, createError } from 'h3';
import { ingestUrl, normalizeCustomSavePath, normalizeDateAfter, syncAllChannels } from '../../../utils/downloader';
import {
  readJsonObject, requiredUrl, optionalBoolean, optionalEnum, optionalString, badRequest,
  upstreamFailure, isHttpError, SYNC_STATUSES, VISIBILITIES,
} from '../../../utils/validation';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readJsonObject(event);
  const url = requiredUrl(body, 'url');
  const download_videos = optionalBoolean(body, 'download_videos');
  const download_shorts = optionalBoolean(body, 'download_shorts');
  const download_lives = optionalBoolean(body, 'download_lives');
  const start_sync = optionalBoolean(body, 'start_sync');
  const sync_status = optionalEnum(body, 'sync_status', SYNC_STATUSES);
  const visibility = optionalEnum(body, 'visibility', VISIBILITIES);
  // Optional hints from a search result: skip even the quick channel lookup.
  const channelId = optionalString(body, 'channelId', { max: 200 });
  const name = optionalString(body, 'name', { max: 500 });
  const avatarUrl = optionalString(body, 'avatarUrl', { max: 2048 });
  const { date_after, custom_save_path } = body;

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
    badRequest('The date must be YYYY-MM-DD.');
  }

  let result: Awaited<ReturnType<typeof ingestUrl>>;
  try {
    result = await ingestUrl(url, {
      download_videos: download_videos !== undefined ? (download_videos ? 1 : 0) : undefined,
      download_shorts: download_shorts !== undefined ? (download_shorts ? 1 : 0) : undefined,
      download_lives: download_lives !== undefined ? (download_lives ? 1 : 0) : undefined,
      date_after: date_after !== undefined ? (normalizeDateAfter(date_after) ?? null) : undefined,
      sync_status,
      visibility,
      custom_save_path: savePath,
      // A channel answers at once; its videos are listed in the background.
      background: true,
      hints: { channelId, name, avatarUrl },
    });
  } catch (err) {
    if (isHttpError(err) && err.statusCode < 500) throw err;
    upstreamFailure('admin/downloader/ingest', err, 'The address could not be read. Check the server logs for details.');
  }
  if (!result.success) {
    upstreamFailure('admin/downloader/ingest', result.message, 'The address could not be read. Check the server logs for details.');
  }

  if (start_sync) {
    // Trigger background sync worker asynchronously
    syncAllChannels();
  }

  return result;
});
