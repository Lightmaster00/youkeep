import { defineEventHandler, readBody, createError } from 'h3';

const KNOWN_PLATFORM_IDS = ['podcastindex', 'listennotes', 'youtube_data_api'];

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const id = typeof body?.id === 'string' ? body.id.trim() : '';

  if (!KNOWN_PLATFORM_IDS.includes(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown search platform id.'
    });
  }

  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiSecret = typeof body?.apiSecret === 'string' ? body.apiSecret.trim() : '';

  const db = getDb();
  db.prepare('UPDATE search_platforms SET api_key = ?, api_secret = ?, updated_at = ? WHERE id = ?')
    .run(apiKey, apiSecret, Date.now(), id);

  return { success: true };
});
