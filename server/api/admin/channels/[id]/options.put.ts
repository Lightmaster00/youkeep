import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }

  const body = await readBody(event);
  const { downloadVideos, downloadShorts, downloadLives, dateAfter, customSavePath } = body;

  const db = getDb();

  // Retrieve existing channel settings to preserve fields if not sent
  const channel = db.prepare('SELECT download_lives FROM channels WHERE id = ?').get(channelId) as { download_lives: number } | undefined;
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
    customSavePath && typeof customSavePath === 'string' && customSavePath.trim().length > 0 ? customSavePath.trim() : null,
    channelId
  );

  // Clean up non-completed videos that no longer match the active preferences
  if (videosVal === 0) {
    db.prepare(`
      DELETE FROM videos 
      WHERE channel_id = ? AND is_short = 0 AND download_status != 'completed'
    `).run(channelId);
  }

  if (shortsVal === 0) {
    db.prepare(`
      DELETE FROM videos 
      WHERE channel_id = ? AND is_short = 1 AND download_status != 'completed'
    `).run(channelId);
  }

  if (formattedDate) {
    db.prepare(`
      DELETE FROM videos 
      WHERE channel_id = ? AND download_status != 'completed' AND upload_date IS NOT NULL AND upload_date < ?
    `).run(channelId, formattedDate);
  }

  return { success: true };
});
