import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { discoverInt } from '../../../utils/musicDiscover';
import { listRecentlyUpdatedShows } from '../../../utils/podcastDiscover';

// "Recently updated" row of the Podcasts Discover page; `language` narrows
// it to one language.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const query = getQuery(event);
  const limit = discoverInt(query.limit, 20, 1, 50);
  const language = query.language ? String(query.language).slice(0, 50) : null;
  return { shows: listRecentlyUpdatedShows(getDb(), session, limit, language) };
});
