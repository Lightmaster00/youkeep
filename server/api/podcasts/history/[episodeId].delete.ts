import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { removeEpisodeFromHistory } from '../../../utils/podcastProgress';
import { isValidPodcastId } from '../../../../shared/podcastProgress';

// Remove one episode from the caller's history (its resume position is lost).
// Idempotent, and works even if the show has since become hidden.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const episodeId = getRouterParam(event, 'episodeId');
  if (!isValidPodcastId(episodeId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid episode id.' });
  }
  return { removed: removeEpisodeFromHistory(getDb(), user.id, episodeId) };
});
