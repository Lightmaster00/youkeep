import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { requireUser } from '../../../../utils/auth';
import { assertVisibleEpisode, saveProgress } from '../../../../utils/podcastProgress';
import { parseProgressInput } from '../../../../../shared/podcastProgress';

// Records the caller's playback position in an episode (sent by the player).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const episode = assertVisibleEpisode(db, user, getRouterParam(event, 'id'));
  const parsed = parseProgressInput(await readBody(event));
  if (!parsed.ok) {
    throw createError({ statusCode: 400, statusMessage: parsed.error });
  }
  return saveProgress(db, user.id, episode, parsed.value);
});
