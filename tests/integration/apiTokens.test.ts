import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApiToken, listApiTokens, revokeApiToken, getUserFromApiToken, hashApiToken } from '../../server/utils/apiTokens';
import { createTestDb, insertUser, insertApiToken } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

describe('createApiToken', () => {
  it('returns a raw token and an id, and stores only the hash', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const result = createApiToken('u1', 'My Phone');

    expect(result.id).toBeTruthy();
    expect(result.token).toMatch(/^yk_/);

    const row = db.prepare('SELECT token_hash, label, user_id FROM api_tokens WHERE id = ?').get(result.id) as any;
    expect(row.token_hash).toBe(hashApiToken(result.token));
    expect(row.token_hash).not.toBe(result.token);
    expect(row.label).toBe('My Phone');
    expect(row.user_id).toBe('u1');
  });
});

describe('listApiTokens', () => {
  it('returns only the given user\'s tokens, never the hash', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertUser(db, { id: 'u2', role: 'user' });
    insertApiToken(db, { id: 't1', userId: 'u1', label: 'Phone', tokenHash: 'hash1' });
    insertApiToken(db, { id: 't2', userId: 'u2', label: 'Tablet', tokenHash: 'hash2' });

    const result = listApiTokens('u1');
    expect(result).toEqual([
      { id: 't1', label: 'Phone', createdAt: expect.any(Number), lastUsedAt: null }
    ]);
    expect(JSON.stringify(result)).not.toContain('hash1');
  });

  it('returns an empty array for a user with no tokens', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    expect(listApiTokens('u1')).toEqual([]);
  });
});

describe('revokeApiToken', () => {
  it('deletes the token and returns true when the caller owns it', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertApiToken(db, { id: 't1', userId: 'u1', tokenHash: 'hash1' });

    expect(revokeApiToken('u1', 't1')).toBe(true);
    expect(db.prepare('SELECT 1 FROM api_tokens WHERE id = ?').get('t1')).toBeUndefined();
  });

  it('returns false and does not delete when the token belongs to another user', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertUser(db, { id: 'u2', role: 'user' });
    insertApiToken(db, { id: 't1', userId: 'u2', tokenHash: 'hash1' });

    expect(revokeApiToken('u1', 't1')).toBe(false);
    expect(db.prepare('SELECT 1 FROM api_tokens WHERE id = ?').get('t1')).toBeTruthy();
  });

  it('returns false for a nonexistent token id', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    expect(revokeApiToken('u1', 'does-not-exist')).toBe(false);
  });
});

describe('getUserFromApiToken', () => {
  it('returns the owning user for a valid token', () => {
    insertUser(db, { id: 'u1', role: 'admin' });
    const created = createApiToken('u1', 'My Phone');

    const result = getUserFromApiToken(created.token);
    expect(result).toEqual({ id: 'u1', username: 'user_u1', role: 'admin', mustChangePassword: false });
  });

  it('returns null for a token that does not exist', () => {
    expect(getUserFromApiToken('yk_does-not-exist')).toBeNull();
  });

  it('returns null for a revoked token', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');
    revokeApiToken('u1', created.id);

    expect(getUserFromApiToken(created.token)).toBeNull();
  });

  it('updates last_used_at on a successful lookup', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    getUserFromApiToken(created.token);

    const row = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(created.id) as any;
    expect(row.last_used_at).not.toBeNull();
  });

  it('does not re-update last_used_at on a second lookup within 60 seconds', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    getUserFromApiToken(created.token);
    const firstRow = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(created.id) as any;

    getUserFromApiToken(created.token);
    const secondRow = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(created.id) as any;

    expect(secondRow.last_used_at).toBe(firstRow.last_used_at);
  });
});
