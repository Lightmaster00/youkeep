import { defineEventHandler } from 'h3';

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'content_search_mode'").get() as { value: string } | undefined;
    return { mode: row?.value === 'global' ? 'global' : 'per_space' };
  } catch {
    return { mode: 'per_space' };
  }
});
