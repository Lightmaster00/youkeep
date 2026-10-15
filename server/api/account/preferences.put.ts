import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';
import { readJsonObject } from '../../utils/validation';
import { getDisplayView, saveUserOverrides, parseChangeOrThrow } from '../../utils/displayPrefsStore';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const change = parseChangeOrThrow(await readJsonObject(event));

  const db = getDb();
  saveUserOverrides(db, session.id, change);
  return getDisplayView(db, session.id);
});
