import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const queue = db.prepare(`
    SELECT 
      v.id, 
      v.title, 
      v.download_status, 
      v.download_progress, 
      v.download_speed, 
      v.download_eta,
      v.priority,
      v.last_error,
      c.title as channel_title
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status IN ('downloading', 'pending', 'failed')
    ORDER BY 
      CASE v.download_status
        WHEN 'downloading' THEN 1
        ELSE 2
      END,
      v.priority DESC,
      CASE WHEN v.download_progress > 0 THEN 0 ELSE 1 END,
      v.created_at ASC
  `).all();

  const history = db.prepare(`
    SELECT 
      v.id, 
      v.title, 
      v.upload_date,
      v.created_at,
      c.title as channel_title
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed'
    ORDER BY v.created_at DESC
    LIMIT 10
  `).all();

  const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
  const isPaused = pausedSetting ? pausedSetting.value === '1' : false;

  const failedRow = db.prepare(`SELECT COUNT(*) as count FROM videos WHERE download_status = 'failed'`).get() as { count: number };
  const failedCount = failedRow?.count || 0;

  return { queue, history, isPaused, failedCount };
});
