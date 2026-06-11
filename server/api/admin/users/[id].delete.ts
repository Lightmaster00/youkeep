import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const currentAdmin = await requireAdmin(event);
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
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found.'
    });
  }

  // Safeguard: Prevent deleting the default seed admin
  if (user.username === 'admin') {
    throw createError({
      statusCode: 400,
      statusMessage: 'The primary seed admin account cannot be deleted.'
    });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  return { success: true };
});
