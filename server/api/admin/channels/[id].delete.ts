import { defineEventHandler, createError } from 'h3';
import fs from 'fs';
import path from 'path';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const db = getDb();

  // 1. Find all videos for this channel
  const videos = db.prepare('SELECT id FROM videos WHERE channel_id = ?').all(channelId) as { id: string }[];

  // 2. Kill active downloads for these videos
  for (const v of videos) {
    cancelDownload(v.id);
  }

  // 3. Delete the channel (cascade deletes videos, video_categories, user_channel_access, etc.)
  const res = db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  // 4. Delete the channel's media folder recursively
  const channelDir = path.resolve(process.cwd(), 'data/downloads', channelId);
  if (fs.existsSync(channelDir)) {
    try {
      fs.rmSync(channelDir, { recursive: true, force: true });
    } catch (err: any) {
      console.error(`Failed to delete channel directory ${channelDir}:`, err);
    }
  }

  return { success: true };
});
