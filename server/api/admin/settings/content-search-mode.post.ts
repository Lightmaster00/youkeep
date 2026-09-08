import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  if (!body || typeof body !== 'object' || (body.mode !== 'per_space' && body.mode !== 'global')) {
    throw createError({ statusCode: 400, statusMessage: "mode must be 'per_space' or 'global'." });
  }

  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('content_search_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(body.mode);

  return { mode: body.mode };
});
