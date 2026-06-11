import { defineEventHandler, readBody, createError } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;

  if (userCount > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Le profil administrateur a déjà été configuré.'
    });
  }

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

  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, created_at)
    VALUES (?, ?, ?, 'admin', ?)
  `).run(adminId, username, passwordHash, Date.now());

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
