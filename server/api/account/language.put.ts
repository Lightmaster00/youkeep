import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';
import { badRequest, readJsonObject } from '../../utils/validation';
import { isLanguageCode } from '../../../shared/languages';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const body = await readJsonObject(event);
  const value = body.uiLanguage;
  if (value !== null && !isLanguageCode(value)) badRequest('Unsupported language.');
  const uiLanguage = value as string | null;
  getDb().prepare('UPDATE users SET ui_language = ? WHERE id = ?').run(uiLanguage, session.id);
  return { uiLanguage };
});
