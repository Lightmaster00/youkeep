import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const setting = db.prepare("SELECT value FROM settings WHERE key = 'default_downloads_dir'").get() as { value: string } | undefined;

  return {
    path: setting?.value || ''
  };
});
