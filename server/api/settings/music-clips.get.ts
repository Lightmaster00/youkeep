import { defineEventHandler } from 'h3';

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string } | undefined;
    return { enabled: row?.value === '1' };
  } catch {
    return { enabled: false };
  }
});
