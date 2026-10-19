import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';
import { getDb } from '../../../utils/db';
import { requireSessionAdmin, hashPassword } from '../../../utils/auth';
import { readJsonObject, validateUsername, validatePassword, isUsernameTaken, optionalStringArray } from '../../../utils/validation';
import { assertChannelsExist, replaceChannelAccess, CHANNEL_ACCESS_MAX } from '../../../utils/userAdmin';
import { recordSecurityEvent } from '../../../utils/securityLog';

export default defineEventHandler(async (event) => {
  const admin = await requireSessionAdmin(event);
  const body = await readJsonObject(event);

  if (body.username === undefined || body.username === '' || body.role === undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Username and role are required.'
    });
  }

  const username = validateUsername(body.username);
  const role = body.role;
  if (role !== 'admin' && role !== 'user') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid role.'
    });
  }

  // An empty or missing password means "generate a temporary one".
  const chosenPassword = body.password === undefined || body.password === null || body.password === ''
    ? null
    : validatePassword(body.password);
  const channelAccess = optionalStringArray(body, 'channelAccess', { maxItems: CHANNEL_ACCESS_MAX, maxLength: 200 }) ?? [];

  const db = getDb();

  // Case-insensitive, normalized uniqueness ("Bob" and "bob" are the same user).
  if (isUsernameTaken(db, username)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Username already exists.'
    });
  }
  assertChannelsExist(db, channelAccess);

  const finalPassword = chosenPassword ?? crypto.randomBytes(6).toString('hex');
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(finalPassword);

  // DB transaction to guarantee atomic updates
  const createUserTransaction = db.transaction(() => {
    // Re-checked inside the transaction: hashing above yielded to the event loop.
    if (isUsernameTaken(db, username)) {
      throw createError({ statusCode: 409, statusMessage: 'Username already exists.' });
    }
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, must_change_password, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(userId, username, passwordHash, role, Date.now());

    // Channel access only matters for standard users (admins see everything).
    if (role === 'user') replaceChannelAccess(db, userId, channelAccess);
  });

  createUserTransaction();
  recordSecurityEvent(event, 'user_created', { userId: admin.id, username: admin.username, targetId: userId, targetName: username, role });

  return {
    success: true,
    userId,
    password: finalPassword
  };
});
