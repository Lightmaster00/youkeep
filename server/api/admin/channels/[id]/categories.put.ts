import { defineEventHandler, readBody, createError } from 'h3';
import { requireSessionAdmin } from '../../../../utils/auth';
import { parseCategories, sanitizeCategoryOverride } from '../../../../utils/channelCategories';

// Sets a channel's categories by hand ({ categories: string[] }) or goes back
// to the automatic ones ({ categories: null }). Admin browser session only.
export default defineEventHandler(async (event) => {
  await requireSessionAdmin(event);
  const channelId = event.context.params?.id;
  if (!channelId) throw createError({ statusCode: 400, statusMessage: 'A channel ID is required.' });

  const body = await readBody(event).catch(() => null);
  if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'categories')) {
    throw createError({ statusCode: 400, statusMessage: 'Send { categories: [...] } or { categories: null }.' });
  }
  const override = sanitizeCategoryOverride((body as any).categories);

  const db = getDb();
  const row = db.prepare('SELECT categories FROM channels WHERE id = ?').get(channelId) as { categories: string | null } | undefined;
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  db.prepare('UPDATE channels SET categories_override = ? WHERE id = ?').run(override === null ? null : JSON.stringify(override), channelId);

  const automatic = parseCategories(row.categories);
  return { categories: override ?? automatic, automatic, override };
});
