import { defineEventHandler, createError } from 'h3';
import { getDb } from '../../../utils/db';
import { requireSessionAdmin } from '../../../utils/auth';
import { assertNotLastAdmin } from '../../../utils/userAdmin';

export default defineEventHandler(async (event) => {
  const currentAdmin = await requireSessionAdmin(event);
  const userId = event.context.params?.id;

  if (!userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User ID is required.'
    });
  }

  // Safeguard: Prevent self-deletion
  if (userId === currentAdmin.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'You cannot delete your own admin account.'
    });
  }

  const db = getDb();
  db.transaction(() => {
    const user = db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
    if (!user) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User not found.'
      });
    }
    // Never leave the instance without an admin.
    assertNotLastAdmin(db, userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  })();

  return { success: true };
});
