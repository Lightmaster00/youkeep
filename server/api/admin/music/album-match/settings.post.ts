import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../../utils/auth';
import { isAlbumMatchingEnabled, setAlbumMatchingEnabled } from '../../../../utils/albumMatchRunner';

// Turns album matching on or off. Turning it off also stops a running run.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event).catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled must be true or false.' });
  }
  const db = getDb();
  setAlbumMatchingEnabled(db, body.enabled);
  return { enabled: isAlbumMatchingEnabled(db) };
});
