import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { discoverInt } from '../../../utils/musicDiscover';
import { listTrendingEpisodes } from '../../../utils/podcastDiscover';

// "Trending episodes" row of the Podcasts Discover page.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const limit = discoverInt(getQuery(event).limit, 12, 1, 50);
  return { episodes: listTrendingEpisodes(getDb(), session, limit) };
});
