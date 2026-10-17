import { defineEventHandler } from 'h3';
import { getRecommendedVideos } from '../../utils/recommend';

export default defineEventHandler(async (event) => {
  // Guests too: /shorts is a public page (public shorts of public channels only).
  const session = await getUserFromSession(event);

  const db = getDb();
  const videos = getRecommendedVideos(db, session, { type: 'short', limit: 15 });
  return { videos };
});
