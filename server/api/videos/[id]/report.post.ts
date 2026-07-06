import { defineEventHandler, createError, readBody } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  const videoId = event.context.params?.id;
  const user = await getUserFromSession(event);

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID required' });
  }

  const { reason } = await readBody(event) || {};

  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: 'Reason required' });
  }

  const db = getDb();

  try {
    const id = crypto.randomUUID();
    const userId = user ? user.id : null;
    
    db.prepare('INSERT INTO reports (id, video_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, videoId, userId, reason, Date.now());
      
    return { success: true, message: 'Video reported successfully' };
  } catch (error: any) {
    console.error('Error reporting video:', error);
    throw createError({ statusCode: 500, statusMessage: 'Internal server error' });
  }
});
