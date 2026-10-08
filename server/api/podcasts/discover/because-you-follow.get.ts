import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { discoverInt } from '../../../utils/musicDiscover';
import { listBecauseYouFollow } from '../../../utils/podcastDiscover';

// "Because you follow <show>" row of the Podcasts Discover page. Personal, so
// empty for guests.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) return { basedOn: null, shows: [] };
  const limit = discoverInt(getQuery(event).limit, 20, 1, 50);
  return listBecauseYouFollow(getDb(), session, limit);
});
