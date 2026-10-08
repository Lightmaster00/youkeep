import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { discoverInt, listRecentAlbums } from '../../../utils/musicDiscover';

// "New albums" row of the Discover page.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const limit = discoverInt(getQuery(event).limit, 20, 1, 50);
  return { albums: listRecentAlbums(getDb(), session, limit) };
});
