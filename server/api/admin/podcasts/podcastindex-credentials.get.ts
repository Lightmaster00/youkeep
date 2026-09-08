import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_key'").get() as { value: string } | undefined;
  const secretRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_secret'").get() as { value: string } | undefined;

  return {
    apiKey: keyRow?.value || '',
    apiSecret: secretRow?.value || ''
  };
});
