import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiSecret = typeof body?.apiSecret === 'string' ? body.apiSecret.trim() : '';

  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'podcastindex_api_key'").run(apiKey);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'podcastindex_api_secret'").run(apiSecret);

  return { success: true };
});
