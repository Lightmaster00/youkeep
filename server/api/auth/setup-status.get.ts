import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  return { setupRequired: userCount === 0 };
});
