import { defineEventHandler, readBody } from 'h3';
import { requireUser } from '../../../utils/auth';
import { followedShowIds, parsePodcastStatusIds } from '../../../utils/podcastFollows';

// Follow state of a rendered list of shows, in one call: `{ followed: [...ids] }`.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const ids = parsePodcastStatusIds(await readBody(event));
  return { followed: followedShowIds(getDb(), user, ids) };
});
