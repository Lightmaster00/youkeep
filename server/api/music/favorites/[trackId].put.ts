import { defineEventHandler, getRouterParam } from 'h3';
import { requireUser } from '../../../utils/auth';
import { addFavorite, assertVisibleTrack } from '../../../utils/musicFavorites';

// Like a track. Liking it again is a no-op.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const trackId = assertVisibleTrack(db, user, getRouterParam(event, 'trackId'));
  addFavorite(db, user.id, trackId);
  return { liked: true };
});
