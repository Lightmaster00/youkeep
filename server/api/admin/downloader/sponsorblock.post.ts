import { defineEventHandler, readBody, createError } from 'h3';
import { SPONSORBLOCK_CATEGORIES, type SponsorBlockAction } from '../../../utils/chapters';

const VALID_ACTIONS: SponsorBlockAction[] = ['ignore', 'mark', 'remove'];

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const db = getDb();

  for (const category of SPONSORBLOCK_CATEGORIES) {
    const action = body?.[category];
    if (action === undefined) continue;
    if (!VALID_ACTIONS.includes(action)) {
      throw createError({ statusCode: 400, statusMessage: `Valeur invalide pour la catégorie "${category}": ${action}` });
    }
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(action, `sponsorblock_${category}`);
  }

  return { success: true };
});
