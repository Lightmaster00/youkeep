import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const row = getDb().prepare('SELECT ui_language FROM users WHERE id = ?').get(session.id) as { ui_language: string | null } | undefined;
  return { uiLanguage: row?.ui_language ?? null };
});
