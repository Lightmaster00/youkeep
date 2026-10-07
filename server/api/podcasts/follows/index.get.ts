import { defineEventHandler } from 'h3';
import { requireUser } from '../../../utils/auth';
import { listFollowedShows } from '../../../utils/podcastFollows';

// The caller's followed shows (newest follow first) with their "new" counts.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  return listFollowedShows(getDb(), user);
});
