import { defineEventHandler, getQuery, getRouterParam } from 'h3';
import { getUserFromSession } from '../../../../utils/auth';
import { discoverInt, listGenreTracks } from '../../../../utils/musicDiscover';

// Tracks of one genre for /music/genre/[name], newest first, paged for "Load
// more". The name matches without regard to case; an unknown genre is simply
// an empty list.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const name = String(getRouterParam(event, 'name', { decode: true }) ?? '').slice(0, 200);
  const query = getQuery(event);
  const limit = discoverInt(query.limit, 30, 1, 100);
  const offset = discoverInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const { items, total } = listGenreTracks(getDb(), session, name, limit, offset);
  return { tracks: items, total };
});
