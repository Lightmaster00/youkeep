import { defineEventHandler, createError } from 'h3';
import { getDb } from '../../../utils/db';
import { requireSessionAdmin } from '../../../utils/auth';

// Dismisses one video report (Settings → Overview). Admin browser session only.
export default defineEventHandler(async (event) => {
  await requireSessionAdmin(event);
  const id = event.context.params?.id;
  if (!id || id.length > 64) {
    throw createError({ statusCode: 404, statusMessage: 'Report not found.' });
  }
  const result = getDb().prepare('DELETE FROM reports WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Report not found.' });
  }
  return { success: true };
});
