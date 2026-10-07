import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { queryRecentEpisodes } from '../../../utils/recentMedia';

// Newest completed episodes across all shows, for /podcasts/recent ("Load more"
// uses limit/offset and `total`). Same visibility rules as the other podcast reads.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '30'), 10) || 30));
  const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);

  const { items, total } = queryRecentEpisodes(db, session, limit, offset);
  return { episodes: items, total };
});
