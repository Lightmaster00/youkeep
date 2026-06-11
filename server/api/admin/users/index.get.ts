import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const users = db.prepare(`
    SELECT id, username, role, created_at 
    FROM users 
    ORDER BY username ASC
  `).all() as any[];

  // Retrieve channel permissions for each user
  for (const user of users) {
    const channelAccess = db.prepare(`
      SELECT channel_id FROM user_channel_access WHERE user_id = ?
    `).all(user.id) as { channel_id: string }[];
    user.channelAccess = channelAccess.map(c => c.channel_id);
  }

  return { users };
});
