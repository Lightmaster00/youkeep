import { defineEventHandler, createError } from 'h3';
import { cancelDownload, normalizeCustomSavePath, normalizeDateAfter } from '../../../../utils/downloader';
import { readJsonObject, optionalBoolean, badRequest } from '../../../../utils/validation';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  // A partial update: a field that is not sent keeps its current value.
  const body = await readJsonObject(event);
  const downloadVideos = optionalBoolean(body, 'downloadVideos');
  const downloadShorts = optionalBoolean(body, 'downloadShorts');
  const downloadLives = optionalBoolean(body, 'downloadLives');
  const { dateAfter, customSavePath } = body;
  if (customSavePath !== undefined && customSavePath !== null && typeof customSavePath !== 'string') {
    badRequest('customSavePath must be a string.');
  }
  // dateAfter: not sent keeps it, null or '' clears it, otherwise a valid date.
  let dateAfterValue: string | null | undefined;
  if (dateAfter === undefined) {
    dateAfterValue = undefined;
  } else if (dateAfter === null || dateAfter === '') {
    dateAfterValue = null;
  } else {
    dateAfterValue = normalizeDateAfter(dateAfter);
    if (!dateAfterValue) badRequest('dateAfter must be a date (YYYY-MM-DD).');
  }

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
  const channel = db.prepare('SELECT download_videos, download_shorts, download_lives, date_after, custom_save_path FROM channels WHERE id = ?').get(channelId) as
    { download_videos: number; download_shorts: number; download_lives: number; date_after: string | null; custom_save_path: string | null } | undefined;
  if (!channel) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  const livesVal = downloadLives !== undefined ? (downloadLives ? 1 : 0) : channel.download_lives;
  const videosVal = downloadVideos !== undefined ? (downloadVideos ? 1 : 0) : channel.download_videos;
  const shortsVal = downloadShorts !== undefined ? (downloadShorts ? 1 : 0) : channel.download_shorts;
  const formattedDate = dateAfterValue !== undefined ? dateAfterValue : channel.date_after;

  // Clean up non-completed videos that no longer match the new preferences,
  // before the channel row changes (its save folder locates the partial files):
  // a running download is stopped and every partial file removed first, so
  // no yt-dlp process keeps writing for a row that no longer exists.
  const removeUnfinished = (where: string, params: unknown[]) => {
    const rows = db.prepare(`SELECT id FROM videos WHERE channel_id = ? AND download_status != 'completed' AND ${where}`).all(channelId, ...params) as { id: string }[];
    for (const row of rows) cancelDownload(row.id, 'failed');
    db.prepare(`DELETE FROM videos WHERE channel_id = ? AND download_status != 'completed' AND ${where}`).run(channelId, ...params);
  };
  // Only for the options this request changes.
  if (downloadVideos === false) removeUnfinished('is_short = 0', []);
  if (downloadShorts === false) removeUnfinished('is_short = 1', []);
  if (dateAfterValue) removeUnfinished('upload_date IS NOT NULL AND upload_date < ?', [dateAfterValue]);

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
