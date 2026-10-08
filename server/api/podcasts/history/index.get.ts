import { defineEventHandler, getQuery } from 'h3';
import { requireUser } from '../../../utils/auth';
import { listPodcastHistory } from '../../../utils/podcastProgress';

// The caller's podcast listening history (started or played episodes, most
// recently listened first), paged for "Load more".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const query = getQuery(event);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '30'), 10) || 30));
  const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);
  return listPodcastHistory(getDb(), user, limit, offset);
});
