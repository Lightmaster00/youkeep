import crypto from 'crypto';
import { createError } from 'h3';
import type { UserSession } from './auth';

const TOKEN_PREFIX = 'yk_';

export function generateApiToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export type ApiTokenScope = 'full' | 'read';
export const API_TOKEN_SCOPES: readonly ApiTokenScope[] = ['full', 'read'];
export const API_TOKEN_READ_ONLY_MESSAGE = 'This API token is read-only.';
/** last_used_at is written at most this often per token. */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/**
 * Stores a new token and returns its id and raw secret (shown once). Without
 * options the token has full access and never expires; the HTTP route applies
 * the safer defaults (read-only, 90 days).
 */
export function createApiToken(
  userId: string,
  label: string,
  opts: { scope?: ApiTokenScope; expiresAt?: number | null } = {}
): { id: string; token: string } {
  const db = getDb();
  const id = crypto.randomUUID();
  const token = generateApiToken();
  const tokenHash = hashApiToken(token);

  db.prepare(`
    INSERT INTO api_tokens (id, user_id, label, token_hash, created_at, last_used_at, expires_at, scope)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(id, userId, label, tokenHash, Date.now(), opts.expiresAt ?? null, opts.scope ?? 'full');

  return { id, token };
}

export interface ApiTokenListItem {
  id: string;
  label: string;
  scope: ApiTokenScope;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
}

export function listApiTokens(userId: string): ApiTokenListItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, label, scope, created_at, expires_at, last_used_at
    FROM api_tokens
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as { id: string; label: string; scope: string; created_at: number; expires_at: number | null; last_used_at: number | null }[];

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    scope: row.scope === 'read' ? 'read' : 'full',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at
  }));
}

export function revokeApiToken(userId: string, tokenId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(tokenId, userId);
  return result.changes > 0;
}

/** Deletes every expired token; returns how many were removed. Never throws. */
export function purgeExpiredApiTokens(): number {
  try {
    return getDb().prepare('DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at <= ?').run(Date.now()).changes;
  } catch (err) {
    console.error('YouKeep: could not purge expired API tokens:', err);
    return 0;
  }
}

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * The user a valid, unexpired token belongs to, or null. When the request
 * method is given, a read-only token used for anything but GET/HEAD is
 * refused with a 403 (it never reaches the route, admin routes included).
 */
export function getUserFromApiToken(token: string, method?: string): UserSession | null {
  const db = getDb();
  const tokenHash = hashApiToken(token);
  const now = Date.now();

  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.must_change_password,
           a.id as token_id, a.scope, a.expires_at, a.last_used_at
    FROM api_tokens a
    JOIN users u ON a.user_id = u.id
    WHERE a.token_hash = ?
  `).get(tokenHash) as {
    id: string; username: string; role: 'admin' | 'user'; must_change_password: number;
    token_id: string; scope: string; expires_at: number | null; last_used_at: number | null;
  } | undefined;

  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= now) return null;
  if (row.scope !== 'full' && method !== undefined && !READ_METHODS.has(method.toUpperCase())) {
    throw createError({ statusCode: 403, statusMessage: API_TOKEN_READ_ONLY_MESSAGE });
  }

  // Only write when the stored value is stale, so a busy client does not
  // cost one database write per request.
  if (row.last_used_at === null || row.last_used_at < now - LAST_USED_WRITE_INTERVAL_MS) {
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.token_id);
  }

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    via: 'token'
  };
}
