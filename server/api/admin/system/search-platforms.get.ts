import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const rows = db.prepare('SELECT id, api_key, api_secret FROM search_platforms').all() as { id: string; api_key: string; api_secret: string }[];

  return {
    platforms: rows.map((row) => ({
      id: row.id,
      apiKey: row.api_key,
      apiSecret: row.api_secret
    }))
  };
});
