import { defineEventHandler, readBody, createError } from 'h3';
import { isValidMaxConcurrentValue } from '../../../utils/concurrency';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const value = body?.maxConcurrentDownloads;

  if (!isValidMaxConcurrentValue(value)) {
    throw createError({ statusCode: 400, statusMessage: 'maxConcurrentDownloads must be an integer >= 1.' });
  }

  const db = getDb();
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'max_concurrent_downloads'`).run(String(value));

  return { success: true };
});
