import { defineEventHandler, createError } from 'h3';
import { getUserFromSession } from '../utils/auth';

export default defineEventHandler(async (event) => {
  const path = event.path || '';
  const isMusicRoute = path.startsWith('/api/music/') || path.startsWith('/downloads-music/');
  if (!isMusicRoute) return;

  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string } | undefined;
  const enabled = row?.value !== '0';
  if (enabled) return;

  const session = await getUserFromSession(event);
  if (session?.role === 'admin') return;

  throw createError({ statusCode: 404, statusMessage: 'Not found.' });
});
