import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';
import { badRequest, readJsonObject } from '../../utils/validation';
import { isLanguageCode } from '../../../shared/languages';
import { getYoutubeApiKey } from '../../utils/videoTranslations';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const body = await readJsonObject(event);
  const value = body.contentLanguage;
  if (value !== 'original' && !isLanguageCode(value)) badRequest('Unsupported language.');
  const db = getDb();
  // 'original' is stored as NULL.
  db.prepare('UPDATE users SET content_language = ? WHERE id = ?').run(value === 'original' ? null : value, session.id);
  return { contentLanguage: value as string, available: getYoutubeApiKey(db) !== '' };
});
