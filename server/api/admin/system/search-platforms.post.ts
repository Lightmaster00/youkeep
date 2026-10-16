import { defineEventHandler, createError } from 'h3';
import { requireSessionAdmin } from '../../../utils/auth';
import { getDb } from '../../../utils/db';
import { readJsonObject, optionalString } from '../../../utils/validation';

const KNOWN_PLATFORM_IDS = ['podcastindex', 'listennotes', 'youtube_data_api'];

// The GET never returns stored secrets, so the form may post back nothing, an
// empty string or the masked value it was shown: all three mean "keep the
// current value". A value is removed only with clearApiKey / clearApiSecret.
function isKeep(value: string | undefined): boolean {
  return value === undefined || value === '' || value.startsWith('•');
}

export default defineEventHandler(async (event) => {
  await requireSessionAdmin(event);
  const body = await readJsonObject(event);
  const id = typeof body.id === 'string' ? body.id.trim() : '';

  if (!KNOWN_PLATFORM_IDS.includes(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown search platform id.'
    });
  }

  const apiKey = optionalString(body, 'apiKey', { max: 500 });
  const apiSecret = optionalString(body, 'apiSecret', { max: 500 });
  if (body.clearApiKey !== undefined && typeof body.clearApiKey !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'clearApiKey must be a boolean.' });
  }
  if (body.clearApiSecret !== undefined && typeof body.clearApiSecret !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'clearApiSecret must be a boolean.' });
  }

  const db = getDb();
  const current = db.prepare('SELECT api_key, api_secret FROM search_platforms WHERE id = ?').get(id) as { api_key: string; api_secret: string } | undefined;
  const nextKey = body.clearApiKey === true ? '' : isKeep(apiKey) ? (current?.api_key ?? '') : apiKey!;
  const nextSecret = body.clearApiSecret === true ? '' : isKeep(apiSecret) ? (current?.api_secret ?? '') : apiSecret!;

  db.prepare('UPDATE search_platforms SET api_key = ?, api_secret = ?, updated_at = ? WHERE id = ?')
    .run(nextKey, nextSecret, Date.now(), id);

  return { success: true };
});
