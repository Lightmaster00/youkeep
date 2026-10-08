import { defineEventHandler, getQuery } from 'h3';
import { requireUser } from '../../../utils/auth';
import { listMusicHistory } from '../../../utils/musicHistory';

// The caller's listening history: one entry per track (latest play first,
// with its play count), paged for "Load more".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const query = getQuery(event);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '30'), 10) || 30));
  const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);
  return listMusicHistory(getDb(), user, limit, offset);
});
