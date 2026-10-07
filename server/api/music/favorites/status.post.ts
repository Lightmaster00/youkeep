import { defineEventHandler, readBody, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { likedTrackIds } from '../../../utils/musicFavorites';
import { FAVORITES_STATUS_MAX_IDS, isValidMediaId } from '../../../../shared/musicPlaylists';

// Like state of a rendered list of tracks, in one call: `{ liked: [...ids] }`.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const body = await readBody(event);
  const ids = body && typeof body === 'object' ? (body as any).ids : undefined;
  if (!Array.isArray(ids) || !ids.every(isValidMediaId)) {
    throw createError({ statusCode: 400, statusMessage: 'ids must be an array of track ids.' });
  }
  if (ids.length > FAVORITES_STATUS_MAX_IDS) {
    throw createError({ statusCode: 400, statusMessage: `At most ${FAVORITES_STATUS_MAX_IDS} ids per request.` });
  }
  return { liked: likedTrackIds(getDb(), user, [...new Set(ids as string[])]) };
});
