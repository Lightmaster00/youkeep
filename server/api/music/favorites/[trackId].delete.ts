import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { removeFavorite } from '../../../utils/musicFavorites';
import { isValidMediaId } from '../../../../shared/musicPlaylists';

// Unlike a track. Works whether or not it was liked, and even if the track
// has since become hidden, so a user can always clean up their own list.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const trackId = getRouterParam(event, 'trackId');
  if (!isValidMediaId(trackId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid track id.' });
  }
  removeFavorite(getDb(), user.id, trackId);
  return { liked: false };
});
