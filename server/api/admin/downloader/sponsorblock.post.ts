import { defineEventHandler, readBody, createError } from 'h3';
import { SPONSORBLOCK_CATEGORIES, type SponsorBlockAction } from '../../../utils/chapters';

const VALID_ACTIONS: SponsorBlockAction[] = ['ignore', 'mark', 'remove'];

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const db = getDb();

  // Pass 1: validate every provided category before writing anything.
  const updates: { category: string; action: SponsorBlockAction }[] = [];
  for (const category of SPONSORBLOCK_CATEGORIES) {
    const action = body?.[category];
    if (action === undefined) continue;
    if (!VALID_ACTIONS.includes(action)) {
      throw createError({ statusCode: 400, statusMessage: `Valeur invalide pour la catégorie "${category}": ${action}` });
    }
    updates.push({ category, action });
  }

  // Pass 2: only write once every provided value has been confirmed valid.
  for (const { category, action } of updates) {
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(action, `sponsorblock_${category}`);
  }

  return { success: true };
});
