import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const queue = db.prepare(`
    SELECT
      e.id,
      e.title,
      e.download_status,
      e.download_progress,
      e.download_speed,
      e.download_eta,
      e.last_error,
      s.title as show_title
    FROM podcast_episodes e
    JOIN podcast_shows s ON e.show_id = s.id
    WHERE e.download_status IN ('downloading', 'pending', 'failed')
    ORDER BY
      CASE e.download_status
        WHEN 'downloading' THEN 1
        ELSE 2
      END,
      CASE WHEN e.download_progress > 0 THEN 0 ELSE 1 END,
      e.created_at ASC
    LIMIT 100
  `).all();

  const history = db.prepare(`
    SELECT
      e.id,
      e.title,
      e.created_at,
      s.title as show_title
    FROM podcast_episodes e
    JOIN podcast_shows s ON e.show_id = s.id
    WHERE e.download_status = 'completed'
    ORDER BY e.created_at DESC
    LIMIT 10
  `).all();

  const shows = db.prepare(`
    SELECT
      s.id,
      s.title,
      s.cover_url,
      s.sync_status,
      s.visibility,
      COUNT(e.id) as episode_count
    FROM podcast_shows s
    LEFT JOIN podcast_episodes e ON e.show_id = s.id
    GROUP BY s.id
    ORDER BY s.title ASC
  `).all();

  const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
  const isPaused = pausedSetting ? pausedSetting.value === '1' : false;

  const failedRow = db.prepare(`SELECT COUNT(*) as count FROM podcast_episodes WHERE download_status = 'failed'`).get() as { count: number };
  const failedCount = failedRow?.count || 0;

  return { queue, history, shows, isPaused, failedCount };
});
