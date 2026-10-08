import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { discoverInt, listArtistsToExplore } from '../../../utils/musicDiscover';

// "Artists to explore" row of the Discover page: artists the user has barely
// played. Personal, so empty for guests.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) return { artists: [] };
  const limit = discoverInt(getQuery(event).limit, 20, 1, 50);
  return { artists: listArtistsToExplore(getDb(), session, limit) };
});
