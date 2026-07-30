import { defineEventHandler, createError } from 'h3';
import { getUserFromSession } from '../utils/auth';

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0] ?? '';
  const isMusicRoute = path === '/api/music' || path.startsWith('/api/music/') || path === '/downloads-music' || path.startsWith('/downloads-music/');
  if (!isMusicRoute) return;

  let enabled = true;
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string } | undefined;
    enabled = row?.value !== '0';
  } catch {
    enabled = true;
  }
  if (enabled) return;

  try {
    const session = await getUserFromSession(event);
    if (session?.role === 'admin') return;
  } catch {
    return;
  }

  throw createError({ statusCode: 404, statusMessage: `Cannot find any route matching ${path}.` });
});
