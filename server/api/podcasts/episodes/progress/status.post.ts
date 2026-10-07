import { defineEventHandler, readBody } from 'h3';
import { requireUser } from '../../../../utils/auth';
import { parsePodcastStatusIds } from '../../../../utils/podcastFollows';
import { progressForEpisodes } from '../../../../utils/podcastProgress';

// The caller's progress for a rendered list of episodes, in one call:
// `{ progress: { [id]: { positionSeconds, durationSeconds, completed, updatedAt } } }`.
// Episodes never started are left out.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const ids = parsePodcastStatusIds(await readBody(event));
  return { progress: progressForEpisodes(getDb(), user, ids) };
});
