import { defineEventHandler, readBody } from 'h3';
import { requireAdmin } from '../../../utils/auth';
import { getDisplayView, saveAdminDefaults, parseChangeOrThrow } from '../../../utils/displayPrefsStore';

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event);
  const change = parseChangeOrThrow(await readBody(event));

  const db = getDb();
  saveAdminDefaults(db, change);
  return getDisplayView(db, session.id);
});
