import { defineEventHandler, readBody, createError } from 'h3';
import { requireSessionAdmin } from '../../../../utils/auth';
import { isMetadataBackfillEnabled, setMetadataBackfillEnabled } from '../../../../utils/metadataBackfill';

// Turns the background lookup on or off. Turning it off also stops a running run.
export default defineEventHandler(async (event) => {
  await requireSessionAdmin(event);
  const body = await readBody(event).catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled must be true or false.' });
  }
  const db = getDb();
  setMetadataBackfillEnabled(db, body.enabled);
  return { enabled: isMetadataBackfillEnabled(db) };
});
