import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { buildLikedMix } from '../../../utils/musicDiscover';

// "Mix from your liked songs" (Discover). Empty for guests and for users with
// no liked track. `seed` makes the mix repeatable; without it every call
// gives a new mix.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) return { tracks: [] };
  const query = getQuery(event);
  const seed = query.seed ? String(query.seed).slice(0, 100) : `${Date.now()}-${Math.random()}`;
  return { tracks: buildLikedMix(getDb(), session, seed) };
});
