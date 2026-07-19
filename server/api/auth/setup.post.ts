import { defineEventHandler, readBody, createError } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  const db = getDb();

  const body = await readBody(event);
  const { username, password } = body;

  if (!username || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nom d\'utilisateur et mot de passe requis.'
    });
  }

  if (password.length < 8) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Le mot de passe doit faire au moins 8 caractères.'
    });
  }

  const passwordHash = hashPassword(password);
  const adminId = crypto.randomUUID();

  // Check-then-insert must happen inside a single synchronous transaction —
  // better-sqlite3 statements never yield to the event loop, so no concurrent
  // request can slip between the count check and the insert this way.
  const setupTransaction = db.transaction(() => {
    const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    if (userCount > 0) {
      throw new Error('ALREADY_SETUP');
    }

    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at)
      VALUES (?, ?, ?, 'admin', ?)
    `).run(adminId, username, passwordHash, Date.now());
  });

  try {
    setupTransaction();
  } catch (err: any) {
    if (err.message === 'ALREADY_SETUP') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Le profil administrateur a déjà été configuré.'
      });
    }
    throw err;
  }

  // Log in automatically after setup
  await createSession(adminId, event);

  return {
    success: true,
    user: {
      id: adminId,
      username,
      role: 'admin',
      mustChangePassword: false
    }
  };
});
