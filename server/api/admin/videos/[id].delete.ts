import { defineEventHandler, createError } from 'h3';
import fs from 'fs';
import path from 'path';
import { channelBaseDirs, isContained, removeVideoFiles, removeVideoLeftovers, resolveStoredPath, videoChannelFolder } from '../../../utils/videoPaths';
import { isTidyRunning } from '../../../utils/videoTidy';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const videoId = event.context.params?.id;

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID is required.' });
  }
  if (isTidyRunning()) {
    throw createError({ statusCode: 409, statusMessage: 'Library files are being tidied. Try again when it has finished.' });
  }

  const db = getDb();

  // 1. Retrieve video details to get local paths and channel ID
  const video = db.prepare('SELECT id, title, channel_id, local_video_path, local_thumbnail_path FROM videos WHERE id = ?').get(videoId) as {
    id: string;
    title: string;
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
  // Where this video's files are, resolved before its row is deleted: its own
  // folder (one folder per video) or, for legacy videos, the channel folder,
  // under the base the downloader wrote it to (see channelBaseDirs).
  const location = resolveStoredPath(db, video, { downloadsDir: getDownloadsDir() });
  const basePath = location.baseDir;
  // The folder holding its video folders (named like the downloader does) and,
  // for downloads made before one folder per video, its flat <id>.* files.
  const channelDir = path.resolve(basePath, videoChannelFolder(channel?.title, video.channel_id));
  const legacyDir = path.resolve(basePath, sanitizeFolderName(channel?.title || video.channel_id));

  // 2. Kill the download if it's running
  cancelDownload(videoId);

  // 3. Delete from database
  db.prepare('DELETE FROM videos WHERE id = ?').run(videoId);

  // Leftovers of earlier attempts under the other base the downloader may have
  // written to (the save folder changed writability, see channelBaseDirs): only
  // this video's own folder and flat partial files there. Its location's base
  // is handled below.
  const otherBases = channelBaseDirs(channel?.custom_save_path, getDownloadsDir())
    .filter((base) => base !== path.resolve(basePath));
  removeVideoLeftovers({ bases: otherBases, channelFolder: sanitizeFolderName(channel?.title || video.channel_id), id: videoId });

  if (location.layout === 'new') {
    let warning: string | undefined;
    // Only a folder directly in this channel's folder (or the channel base
    // itself, for a custom save path ending in the channel folder name) is
    // ever touched; a stored path pointing elsewhere is left alone.
    const parent = path.dirname(location.dir);
    const inChannelFolder = parent === channelDir
      || (parent === path.resolve(basePath) && path.basename(parent) === path.basename(channelDir));
    if (inChannelFolder) {
      // Removes the folder only when it holds nothing but this video's files.
      const { failed } = removeVideoFiles(location);
      if (failed > 0) warning = `The video was deleted, but ${failed} of its files could not be removed from disk (see the server log).`;
    } else {
      console.error(`Video ${videoId}: stored folder ${location.dir} is outside its channel folder ${channelDir}; files left in place.`);
      warning = 'The video was deleted, but its files are outside its channel folder and were left in place.';
    }
    // A video without a stored path may still have partial files from a
    // download started before the one-folder-per-video layout: fall through
    // to the legacy list below (exact <id>.<ext> names in the channel folder).
    if (video.local_video_path) return warning ? { success: true, warning } : { success: true };
  }

  // 4. Remove local files from disk (any container extension, thumbnail,
  // subtitles, metadata, and partial-download leftovers), only from a folder
  // strictly inside the base (a title like '..' points at the folder above it).
  if (!isContained(basePath, legacyDir)) return { success: true };
  const videoExtensions = ['mp4', 'webm', 'mkv', '3gp', 'flv'];
  const filesToRemove = [
    ...videoExtensions.map(ext => path.join(legacyDir, `${videoId}.${ext}`)),
    ...videoExtensions.map(ext => path.join(legacyDir, `${videoId}.${ext}.part`)),
    ...videoExtensions.map(ext => path.join(legacyDir, `${videoId}.${ext}.ytdl`)),
    path.join(legacyDir, `${videoId}.jpg`),
    path.join(legacyDir, `${videoId}.vtt`),
    path.join(legacyDir, `${videoId}.info.json`),
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
