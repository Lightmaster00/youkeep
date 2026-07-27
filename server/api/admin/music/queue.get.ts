import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const queue = db.prepare(`
    SELECT
      t.id,
      t.title,
      t.download_status,
      t.download_progress,
      t.download_speed,
      t.download_eta,
      t.last_error,
      a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status IN ('downloading', 'pending', 'failed')
    ORDER BY
      CASE t.download_status
        WHEN 'downloading' THEN 1
        ELSE 2
      END,
      CASE WHEN t.download_progress > 0 THEN 0 ELSE 1 END,
      t.created_at ASC
    LIMIT 100
  `).all();

  const history = db.prepare(`
    SELECT
      t.id,
      t.title,
      t.created_at,
      a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed'
    ORDER BY t.created_at DESC
    LIMIT 10
  `).all();

  const artists = db.prepare(`
    SELECT
      a.id,
      a.name,
      a.avatar_url,
      a.sync_status,
      a.visibility,
      COUNT(t.id) as track_count
    FROM music_artists a
    LEFT JOIN music_tracks t ON t.artist_id = a.id
    GROUP BY a.id
    ORDER BY a.name ASC
  `).all();

  const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
  const isPaused = pausedSetting ? pausedSetting.value === '1' : false;

  const failedRow = db.prepare(`SELECT COUNT(*) as count FROM music_tracks WHERE download_status = 'failed'`).get() as { count: number };
  const failedCount = failedRow?.count || 0;

  return { queue, history, artists, isPaused, failedCount };
});
