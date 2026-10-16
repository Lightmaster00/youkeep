import { defineEventHandler } from 'h3';
import { ingestPodcastFeed } from '../../../utils/podcastDownloader';
import { describeErrorForLog } from '../../../utils/redact';
import {
  readJsonObject, requiredUrl, optionalEnum, badRequest, upstreamFailure, isHttpError, SYNC_STATUSES, VISIBILITIES,
} from '../../../utils/validation';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readJsonObject(event);
  const feedUrl = requiredUrl(body, 'feedUrl');
  const sync_status = optionalEnum(body, 'sync_status', SYNC_STATUSES);
  const visibility = optionalEnum(body, 'visibility', VISIBILITIES);

  let result: Awaited<ReturnType<typeof ingestPodcastFeed>>;
  try {
    result = await ingestPodcastFeed(feedUrl, { sync_status, visibility });
  } catch (err) {
    if (isHttpError(err) && err.statusCode < 500) throw err;
    // Private feed URLs often carry a token in the query string.
    upstreamFailure('admin/podcasts/ingest', describeErrorForLog(err), 'The feed could not be read. Check the server logs for details.');
  }
  if (!result.success) {
    if (result.message.startsWith('This feed address is not allowed')) badRequest('This feed address is not allowed.');
    upstreamFailure('admin/podcasts/ingest', describeErrorForLog(result.message), 'The feed could not be read. Check the server logs for details.');
  }
  return result;
});
