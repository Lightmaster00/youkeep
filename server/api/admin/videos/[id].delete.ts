import { defineEventHandler, createError } from 'h3';
import fs from 'fs';
import path from 'path';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const videoId = event.context.params?.id;

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID is required.' });
  }

  const db = getDb();

  // 1. Retrieve video details to get local paths and channel ID
  const video = db.prepare('SELECT channel_id, local_video_path, local_thumbnail_path FROM videos WHERE id = ?').get(videoId) as {
    channel_id: string;
    local_video_path: string | null;
    local_thumbnail_path: string | null;
  } | undefined;

  if (!video) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }

  // 2. Kill the download if it's running
  cancelDownload(videoId);

  // 3. Delete from database
  db.prepare('DELETE FROM videos WHERE id = ?').run(videoId);

  // 4. Remove local files from disk
  const channelDir = path.resolve(process.cwd(), 'data/downloads', video.channel_id);
  const mp4File = path.join(channelDir, `${videoId}.mp4`);
  const jpgFile = path.join(channelDir, `${videoId}.jpg`);
  const partFile = path.join(channelDir, `${videoId}.mp4.part`);
  const ytdlPartFile = path.join(channelDir, `${videoId}.mp4.ytdl`);

  [mp4File, jpgFile, partFile, ytdlPartFile].forEach(f => {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch (err: any) {
        console.error(`Failed to delete video file ${f}:`, err);
      }
    }
  });

  return { success: true };
});
