import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';
import { getContentLanguage, getYoutubeApiKey } from '../../utils/videoTranslations';

// The language of video titles/descriptions ('original' = as uploaded), and
// whether translations can be fetched at all (a YouTube Data API key is set).
export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const db = getDb();
  return { contentLanguage: getContentLanguage(db, session.id) ?? 'original', available: getYoutubeApiKey(db) !== '' };
});
