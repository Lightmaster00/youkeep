import { defineEventHandler, createError } from 'h3';
import { getRecommendedVideos } from '../../utils/recommend';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized.' });
  }

  const db = getDb();
  const videos = getRecommendedVideos(db, session.id, { type: 'short', limit: 15 });
  return { videos };
});
