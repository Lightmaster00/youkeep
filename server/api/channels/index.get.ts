import { defineEventHandler, getQuery } from 'h3';
import { parseChannelListQuery, queryChannelDirectory } from '../../utils/channelDirectory';

// The channels directory: filters (category=, q=, following=), sort=, and
// paging (page=/limit=; without either, every channel as before). Counts only
// cover the videos this viewer may see; one set-based query
// (server/utils/channelDirectory.ts).
export default defineEventHandler(async (event) => {
  const opts = parseChannelListQuery(getQuery(event));
  const session = await getUserFromSession(event);
  const { channels, total } = queryChannelDirectory(getDb(), session, opts);
  return opts.page !== null
    ? { channels, total, page: opts.page, limit: opts.limit }
    : { channels, total };
});
