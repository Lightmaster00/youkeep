import { defineEventHandler } from 'h3';
import { getDb } from '../../../utils/db';
import { requireSessionAdmin } from '../../../utils/auth';

// The latest video reports, for the admin's Settings → Overview card. Admin
// browser session only (an API token gets 403).
export default defineEventHandler(async (event) => {
  await requireSessionAdmin(event);
  const db = getDb();
  const reports = db.prepare(`
    SELECT r.id, r.video_id AS videoId, r.reason, r.created_at AS createdAt,
           v.title AS videoTitle, c.title AS channelTitle, v.channel_id AS channelId,
           u.username AS reporter
    FROM reports r
    JOIN videos v ON v.id = r.video_id
    JOIN channels c ON c.id = v.channel_id
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC, r.id ASC
    LIMIT 100
  `).all();
  return { reports };
});
