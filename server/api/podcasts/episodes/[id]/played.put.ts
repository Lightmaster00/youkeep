import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { requireUser } from '../../../../utils/auth';
import { assertVisibleEpisode, setPlayed } from '../../../../utils/podcastProgress';

// "Mark as played" (`{ played: true }`) or "Mark as unplayed" (`false`).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const episode = assertVisibleEpisode(db, user, getRouterParam(event, 'id'));
  const body = await readBody(event);
  const played = body && typeof body === 'object' ? (body as any).played : undefined;
  if (typeof played !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'played must be true or false.' });
  }
  return { played, progress: setPlayed(db, user.id, episode, played) };
});
