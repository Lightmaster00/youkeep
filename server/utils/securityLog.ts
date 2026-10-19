import type { H3Event } from 'h3';
import { getDb } from './db';
import { getClientIp } from './trustProxy';

/**
 * Security log: who did what security-relevant thing, from where. Admins read
 * it in Settings → System. Kept SECURITY_EVENT_RETENTION_MS and at most
 * SECURITY_EVENT_MAX_ROWS rows. Passwords, tokens, hashes, keys and cookies are
 * never stored: their keys are dropped from the details.
 */

export type SecurityEventType =
  | 'login_failed'
  | 'login_new_ip'
  | 'password_changed'
  | 'password_reset'
  | 'token_created'
  | 'token_revoked'
  | 'user_created'
  | 'user_deleted'
  | 'user_role_changed'
  | 'library_wipe_started'
  | 'library_tidy_started';

export interface SecurityEventDetails {
  /** The user the event is about (the actor, or the attempted name for a failed login). */
  userId?: string | null;
  username?: string | null;
  [key: string]: string | number | boolean | null | undefined;
}

export interface SecurityEventRow {
  id: number;
  createdAt: number;
  type: string;
  ip: string | null;
  userId: string | null;
  username: string | null;
  details: Record<string, unknown>;
}

export const SECURITY_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const SECURITY_EVENT_MAX_ROWS = 5000;
const MAX_VALUE_LENGTH = 100;
const MAX_DETAIL_KEYS = 10;
// Keys whose values are credentials: never written, whatever the caller passes.
const SENSITIVE_KEY = /pass|secret|hash|token$|^token|key|cookie|authorization|session/i;
const ALLOWED_TOKEN_KEYS = new Set(['tokenId', 'tokenLabel', 'tokenScope']);

function clip(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).slice(0, MAX_VALUE_LENGTH);
}

function cleanDetails(details: SecurityEventDetails): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (key === 'userId' || key === 'username' || value === undefined) continue;
    if (SENSITIVE_KEY.test(key) && !ALLOWED_TOKEN_KEYS.has(key)) continue;
    if (value !== null && typeof value === 'object') continue;
    if (Object.keys(out).length >= MAX_DETAIL_KEYS) break;
    out[key] = clip(value);
  }
  return out;
}

/** Records one event. Never throws: logging must not break the action it describes. */
export function recordSecurityEvent(event: H3Event | null, type: SecurityEventType, details: SecurityEventDetails = {}): void {
  try {
    let ip: string | null = null;
    if (event) {
      try { ip = getClientIp(event).slice(0, 64); } catch { ip = null; }
    }
    const clean = cleanDetails(details);
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO security_events (created_at, type, ip, user_id, username, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(), type, ip,
      details.userId == null ? null : String(details.userId).slice(0, MAX_VALUE_LENGTH),
      details.username == null ? null : String(details.username).slice(0, MAX_VALUE_LENGTH),
      Object.keys(clean).length ? JSON.stringify(clean) : null
    );
    // Cap the table on every write: a burst of failed logins cannot grow it.
    db.prepare('DELETE FROM security_events WHERE id <= ?').run(Number(result.lastInsertRowid) - SECURITY_EVENT_MAX_ROWS);
  } catch (err) {
    console.error('YouKeep: could not record a security event:', err);
  }
}

/** Deletes events past the retention period; returns how many. Never throws. */
export function purgeSecurityEvents(): number {
  try {
    return getDb().prepare('DELETE FROM security_events WHERE created_at < ?').run(Date.now() - SECURITY_EVENT_RETENTION_MS).changes;
  } catch (err) {
    console.error('YouKeep: could not purge the security log:', err);
    return 0;
  }
}

/** True when `userId` already signed in from `ip` (within the retention period). */
export function isKnownLoginIp(userId: string, ip: string): boolean {
  try {
    return !!getDb().prepare("SELECT 1 FROM security_events WHERE type = 'login_new_ip' AND user_id = ? AND ip = ? LIMIT 1").get(userId, ip);
  } catch {
    return true;
  }
}

/** The newest events first. */
export function listSecurityEvents(limit: number): SecurityEventRow[] {
  const rows = getDb().prepare(`
    SELECT id, created_at, type, ip, user_id, username, details
    FROM security_events
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as { id: number; created_at: number; type: string; ip: string | null; user_id: string | null; username: string | null; details: string | null }[];
  return rows.map((row) => {
    let details: Record<string, unknown> = {};
    try { details = row.details ? JSON.parse(row.details) : {}; } catch {}
    return { id: row.id, createdAt: row.created_at, type: row.type, ip: row.ip, userId: row.user_id, username: row.username, details };
  });
}
