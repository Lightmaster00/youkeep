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

  // Resolve the channel's actual on-disk directory (default downloads dir or
  // a custom_save_path) *before* deleting, so custom-path channels don't leak files.
  const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(video.channel_id) as {
    title: string;
    custom_save_path: string | null;
  } | undefined;
  const basePath = channel?.custom_save_path && channel.custom_save_path.trim().length > 0
    ? channel.custom_save_path
    : getDownloadsDir();
  const channelDir = path.resolve(basePath, sanitizeFolderName(channel?.title || video.channel_id));

  // 2. Kill the download if it's running
  cancelDownload(videoId);

  // 3. Delete from database
  db.prepare('DELETE FROM videos WHERE id = ?').run(videoId);

  // 4. Remove local files from disk (any container extension, thumbnail,
  // subtitles, metadata, and partial-download leftovers)
  const videoExtensions = ['mp4', 'webm', 'mkv', '3gp', 'flv'];
  const filesToRemove = [
    ...videoExtensions.map(ext => path.join(channelDir, `${videoId}.${ext}`)),
    ...videoExtensions.map(ext => path.join(channelDir, `${videoId}.${ext}.part`)),
    ...videoExtensions.map(ext => path.join(channelDir, `${videoId}.${ext}.ytdl`)),
    path.join(channelDir, `${videoId}.jpg`),
    path.join(channelDir, `${videoId}.vtt`),
    path.join(channelDir, `${videoId}.info.json`),
  ];

  filesToRemove.forEach(f => {
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
