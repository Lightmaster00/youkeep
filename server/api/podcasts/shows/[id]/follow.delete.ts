import { defineEventHandler, getRouterParam } from 'h3';
import { requireUser } from '../../../../utils/auth';
import { assertVisibleShow, unfollowShow } from '../../../../utils/podcastFollows';

// Unfollow a show. Works whether or not it was followed.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const showId = assertVisibleShow(db, user, getRouterParam(event, 'id'));
  unfollowShow(db, user.id, showId);
  return { followed: false };
});
