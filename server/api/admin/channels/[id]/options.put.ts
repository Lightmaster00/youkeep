import { defineEventHandler, readBody, createError } from 'h3';
import { cancelDownload, normalizeCustomSavePath } from '../../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const body = await readBody(event);
  const { downloadVideos, downloadShorts, downloadLives, dateAfter, customSavePath } = body;

  // A save folder is an absolute path without '..' (empty clears it).
  let savePath: string | null = null;
  if (customSavePath !== undefined && customSavePath !== null && !(typeof customSavePath === 'string' && customSavePath.trim() === '')) {
    savePath = normalizeCustomSavePath(customSavePath);
    if (!savePath) {
      throw createError({ statusCode: 400, statusMessage: 'The save folder must be an absolute path without "..".' });
    }
  }

  const db = getDb();

  // Retrieve existing channel settings to preserve fields if not sent
  const channel = db.prepare('SELECT download_lives, custom_save_path FROM channels WHERE id = ?').get(channelId) as { download_lives: number; custom_save_path: string | null } | undefined;
  if (!channel) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  const livesVal = downloadLives !== undefined ? (downloadLives ? 1 : 0) : channel.download_lives;
  const videosVal = downloadVideos ? 1 : 0;
  const shortsVal = downloadShorts ? 1 : 0;
  
  // Format dateAfter from YYYY-MM-DD to YYYYMMDD
  let formattedDate: string | null = null;
  if (dateAfter && typeof dateAfter === 'string' && dateAfter.match(/^\d{4}-\d{2}-\d{2}$/)) {
    formattedDate = dateAfter.replace(/-/g, '');
  }

  // Clean up non-completed videos that no longer match the new preferences,
  // before the channel row changes (its save folder locates the partial files):
  // a running download is stopped and every partial file removed first, so
  // no yt-dlp process keeps writing for a row that no longer exists.
  const removeUnfinished = (where: string, params: unknown[]) => {
    const rows = db.prepare(`SELECT id FROM videos WHERE channel_id = ? AND download_status != 'completed' AND ${where}`).all(channelId, ...params) as { id: string }[];
    for (const row of rows) cancelDownload(row.id, 'failed');
    db.prepare(`DELETE FROM videos WHERE channel_id = ? AND download_status != 'completed' AND ${where}`).run(channelId, ...params);
  };
  if (videosVal === 0) removeUnfinished('is_short = 0', []);
  if (shortsVal === 0) removeUnfinished('is_short = 1', []);
  if (formattedDate) removeUnfinished('upload_date IS NOT NULL AND upload_date < ?', [formattedDate]);

  // Update channel options
  db.prepare(`
    UPDATE channels 
    SET 
      download_videos = ?, 
      download_shorts = ?, 
      download_lives = ?, 
      date_after = ?,
      custom_save_path = ?
    WHERE id = ?
  `).run(
    videosVal,
    shortsVal,
    livesVal,
    formattedDate,
    // Not sent: the save folder stays as it is.
    customSavePath === undefined ? channel.custom_save_path : savePath,
    channelId
  );

  return { success: true };
});
