import { defineEventHandler } from 'h3';

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string } | undefined;
    return { enabled: row?.value !== '0' };
  } catch {
    return { enabled: true };
  }
});
