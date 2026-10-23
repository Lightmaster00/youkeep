import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event);
  if (!user) return { user };
  const row = getDb().prepare('SELECT ui_language, content_language FROM users WHERE id = ?').get(user.id) as { ui_language: string | null; content_language: string | null } | undefined;
  return { user: { ...user, uiLanguage: row?.ui_language ?? null, contentLanguage: row?.content_language ?? 'original' } };
});
