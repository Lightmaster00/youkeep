import { createError } from 'h3';
import type Database from 'better-sqlite3';

// Shared rules for the admin user-management routes.

export const LAST_ADMIN_MESSAGE = 'At least one admin account must remain.';

/** Max channel grants accepted in one request. */
export const CHANNEL_ACCESS_MAX = 5000;

export function adminCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
}

/**
 * Throws a 409 when removing the admin role from (or deleting) `userId` would
 * leave no admin. Call it inside the same transaction as the write.
 */
export function assertNotLastAdmin(db: Database.Database, userId: string): void {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  if (row?.role !== 'admin') return;
  if (adminCount(db) <= 1) {
    throw createError({ statusCode: 409, statusMessage: LAST_ADMIN_MESSAGE });
  }
}

/** Throws a 400 naming the first channel id that does not exist. */
export function assertChannelsExist(db: Database.Database, channelIds: string[]): void {
  const exists = db.prepare('SELECT 1 FROM channels WHERE id = ?');
  for (const id of channelIds) {
    if (!exists.get(id)) {
      throw createError({ statusCode: 400, statusMessage: `Unknown channel id: ${id.slice(0, 100)}` });
    }
  }
}

export function replaceChannelAccess(db: Database.Database, userId: string, channelIds: string[]): void {
  db.prepare('DELETE FROM user_channel_access WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO user_channel_access (user_id, channel_id) VALUES (?, ?)');
  for (const channelId of channelIds) insert.run(userId, channelId);
}
