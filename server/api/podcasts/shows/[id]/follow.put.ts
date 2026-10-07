import { defineEventHandler, getRouterParam } from 'h3';
import { requireUser } from '../../../../utils/auth';
import { assertVisibleShow, followShow } from '../../../../utils/podcastFollows';

// Follow a show. Following it again is a no-op that keeps the original date.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const showId = assertVisibleShow(db, user, getRouterParam(event, 'id'));
  followShow(db, user.id, showId);
  return { followed: true };
});
