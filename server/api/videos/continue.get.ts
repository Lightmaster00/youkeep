import { defineEventHandler, getQuery } from 'h3';
import { requireUser } from '../../utils/auth';
import { queryContinueWatching } from '../../utils/watchProgress';
import { applyVideoTextLanguage } from '../../utils/videoTranslations';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// "Continue watching": the signed-in viewer's started, unfinished long videos.
export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const raw = Number.parseInt(String(getQuery(event).limit ?? ''), 10);
  const limit = Number.isFinite(raw) ? Math.min(MAX_LIMIT, Math.max(1, raw)) : DEFAULT_LIMIT;
  const db = getDb();
  const videos = queryContinueWatching(db, session, limit);
  applyVideoTextLanguage(db, session, videos);
  return { videos };
});
