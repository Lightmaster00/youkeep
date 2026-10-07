import { defineEventHandler, getQuery } from 'h3';
import { requireUser } from '../../utils/auth';
import { listContinueEpisodes } from '../../utils/podcastProgress';

// "Continue listening": the caller's started, unfinished episodes.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const query = getQuery(event);
  const limit = Math.min(50, Math.max(1, parseInt(String(query.limit ?? '12'), 10) || 12));
  return { items: listContinueEpisodes(getDb(), user, limit) };
});
