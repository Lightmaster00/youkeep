import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../../utils/auth';
import { startAlbumMatchRun } from '../../../../utils/albumMatchRunner';

// Starts matching in the background; the request never waits for iTunes.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event).catch(() => null);
  const scope = body?.scope ?? 'unchecked';
  if (scope !== 'unchecked' && scope !== 'unmatched') {
    throw createError({ statusCode: 400, statusMessage: "scope must be 'unchecked' or 'unmatched'." });
  }
  const result = startAlbumMatchRun(scope, getDb());
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }
  return result;
});
