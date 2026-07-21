import { defineEventHandler } from 'h3';
import { SPONSORBLOCK_CATEGORIES } from '../../../utils/chapters';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'sponsorblock_%'`).all() as { key: string; value: string }[];

  const settings: Record<string, string> = {};
  for (const category of SPONSORBLOCK_CATEGORIES) {
    settings[category] = 'ignore';
  }
  for (const row of rows) {
    settings[row.key.replace('sponsorblock_', '')] = row.value;
  }

  return { settings };
});
