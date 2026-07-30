import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  if (!body || typeof body !== 'object' || typeof body.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled (boolean) is required.' });
  }

  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(body.enabled ? '1' : '0');

  return { enabled: body.enabled };
});
