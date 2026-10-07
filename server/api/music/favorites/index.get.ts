import { defineEventHandler, getQuery } from 'h3';
import { requireUser } from '../../../utils/auth';
import { listFavoriteTracks } from '../../../utils/musicFavorites';

// The caller's liked songs, newest like first, paged for "Load more".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const query = getQuery(event);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '50'), 10) || 50));
  const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);
  return listFavoriteTracks(getDb(), user, limit, offset);
});
