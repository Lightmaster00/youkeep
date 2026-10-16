import { defineEventHandler } from 'h3';
import { ingestMusicUrl } from '../../../utils/musicDownloader';
import {
  readJsonObject, requiredUrl, optionalEnum, optionalString, upstreamFailure, isHttpError, SYNC_STATUSES, VISIBILITIES,
} from '../../../utils/validation';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readJsonObject(event);
  const url = requiredUrl(body, 'url');
  const sync_status = optionalEnum(body, 'sync_status', SYNC_STATUSES);
  const visibility = optionalEnum(body, 'visibility', VISIBILITIES);
  // Optional hints from a search result: with them the artist is created
  // at once and its tracks are listed in the background.
  const channelId = optionalString(body, 'channelId', { max: 200 });
  const name = optionalString(body, 'name', { max: 500 });
  const avatarUrl = optionalString(body, 'avatarUrl', { max: 2048 });

  let result: Awaited<ReturnType<typeof ingestMusicUrl>>;
  try {
    result = await ingestMusicUrl(url, { sync_status, visibility, hints: { channelId, name, avatarUrl } });
  } catch (err) {
    if (isHttpError(err) && err.statusCode < 500) throw err;
    upstreamFailure('admin/music/ingest', err, 'The address could not be read. Check the server logs for details.');
  }
  if (!result.success) {
    upstreamFailure('admin/music/ingest', result.message, 'The address could not be read. Check the server logs for details.');
  }
  return result;
});
