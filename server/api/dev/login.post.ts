import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEV_LOGIN !== '1') {
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }

  const db = getDb();
  const FIXTURE_USERNAME = 'dev-fixture-admin';

  let user = db.prepare('SELECT id FROM users WHERE username = ?').get(FIXTURE_USERNAME) as { id: string } | undefined;

  if (!user) {
    const userId = crypto.randomUUID();
    const passwordHash = hashPassword(crypto.randomUUID()); // random, unused — this endpoint bypasses password login entirely
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at)
      VALUES (?, ?, ?, 'admin', ?)
    `).run(userId, FIXTURE_USERNAME, passwordHash, Date.now());
    user = { id: userId };
  }

  await createSession(user.id, event);

  return { success: true, username: FIXTURE_USERNAME };
});
