import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { removeTrackFromHistory } from '../../../utils/musicHistory';
import { isValidMediaId } from '../../../../shared/musicPlaylists';

// Remove one track (all of its plays) from the caller's history. Idempotent,
// and works even if the track has since become hidden.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const trackId = getRouterParam(event, 'trackId');
  if (!isValidMediaId(trackId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid track id.' });
  }
  return { removed: removeTrackFromHistory(getDb(), user.id, trackId) };
});
