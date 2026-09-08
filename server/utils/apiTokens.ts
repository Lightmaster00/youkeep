import crypto from 'crypto';
import type { UserSession } from './auth';

const TOKEN_PREFIX = 'yk_';

export function generateApiToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createApiToken(userId: string, label: string): { id: string; token: string } {
  const db = getDb();
  const id = crypto.randomUUID();
  const token = generateApiToken();
  const tokenHash = hashApiToken(token);

  db.prepare(`
    INSERT INTO api_tokens (id, user_id, label, token_hash, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(id, userId, label, tokenHash, Date.now());

  return { id, token };
}

export function listApiTokens(userId: string): { id: string; label: string; createdAt: number; lastUsedAt: number | null }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, label, created_at, last_used_at
    FROM api_tokens
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as { id: string; label: string; created_at: number; last_used_at: number | null }[];

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }));
}

export function revokeApiToken(userId: string, tokenId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(tokenId, userId);
  return result.changes > 0;
}

export function getUserFromApiToken(token: string): UserSession | null {
  const db = getDb();
  const tokenHash = hashApiToken(token);

  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.must_change_password, a.id as token_id
    FROM api_tokens a
    JOIN users u ON a.user_id = u.id
    WHERE a.token_hash = ?
  `).get(tokenHash) as { id: string; username: string; role: 'admin' | 'user'; must_change_password: number; token_id: string } | undefined;

  if (!row) return null;

  db.prepare(`
    UPDATE api_tokens
    SET last_used_at = ?
    WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)
  `).run(Date.now(), row.token_id, Date.now() - 60_000);

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    mustChangePassword: row.must_change_password === 1
  };
}
