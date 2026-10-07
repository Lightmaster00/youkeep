import { defineEventHandler, getQuery } from 'h3';
import { requireUser } from '../../utils/auth';
import { listSubscribedEpisodes } from '../../utils/podcastProgress';

// Latest episodes of the caller's followed shows, paged for "Load more".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const query = getQuery(event);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '30'), 10) || 30));
  const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);
  return listSubscribedEpisodes(getDb(), user, limit, offset);
});
