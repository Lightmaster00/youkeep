import { createError, readBody, type H3Event } from 'h3';
import type Database from 'better-sqlite3';

// Shared request-body validation. Every helper throws a 400 (never lets a
// malformed value reach SQLite or a string method and turn into a 500).

export function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Reads the JSON body and returns it as a plain object. Invalid JSON, an empty
 * body, null, an array, a string or a number are all a 400.
 */
export async function readJsonObject(event: H3Event): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await readBody(event, { strict: true });
  } catch {
    badRequest('The request body must be a JSON object.');
  }
  if (!isPlainObject(body)) badRequest('The request body must be a JSON object.');
  return body;
}

/** Optional string field: undefined/null when absent, 400 when present but not a string or too long. */
export function optionalString(body: Record<string, unknown>, key: string, opts: { max: number; trim?: boolean }): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') badRequest(`${key} must be a string.`);
  const out = opts.trim === false ? value : value.trim();
  if (out.length > opts.max) badRequest(`${key} must be at most ${opts.max} characters.`);
  return out;
}

/** Optional array of strings: undefined when absent, 400 on any other shape or above the caps. */
export function optionalStringArray(body: Record<string, unknown>, key: string, opts: { maxItems: number; maxLength: number }): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) badRequest(`${key} must be an array of strings.`);
  if (value.length > opts.maxItems) badRequest(`${key} has too many entries (at most ${opts.maxItems}).`);
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > opts.maxLength) {
      badRequest(`${key} must be an array of non-empty strings.`);
    }
  }
  return [...new Set(value as string[])];
}

// --- Usernames ---------------------------------------------------------------

export const USERNAME_MAX_LENGTH = 64;
// Letters (any script, with combining marks), digits, space and . _ @ -
const USERNAME_CHARSET = /^[\p{L}\p{M}\p{N} ._@-]+$/u;

/** NFKC + trim: the canonical form a username is stored and looked up in. */
export function normalizeUsername(raw: string): string {
  return raw.normalize('NFKC').trim();
}

/** Key used for case-insensitive uniqueness ("Bob" and "bob" are the same user). */
export function usernameKey(raw: string): string {
  return normalizeUsername(raw).toLowerCase();
}

/** Validates a username from a request body and returns its normalized form. */
export function validateUsername(raw: unknown): string {
  if (typeof raw !== 'string') badRequest('Username must be a string.');
  const name = normalizeUsername(raw);
  const length = [...name].length;
  if (length < 1 || length > USERNAME_MAX_LENGTH) {
    badRequest(`Username must be between 1 and ${USERNAME_MAX_LENGTH} characters.`);
  }
  if (!USERNAME_CHARSET.test(name)) {
    badRequest('Username may only contain letters, digits, spaces and . _ @ -');
  }
  return name;
}

/**
 * True when another user already has this username, compared case-insensitively
 * after normalization. The users table's own UNIQUE constraint is case-sensitive.
 */
export function isUsernameTaken(db: Database.Database, username: string, exceptUserId?: string): boolean {
  const key = usernameKey(username);
  const rows = db.prepare('SELECT id, username FROM users').all() as { id: string; username: string }[];
  return rows.some((row) => row.id !== exceptUserId && usernameKey(row.username) === key);
}

// --- Passwords ---------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores everything after 72 bytes.
export const PASSWORD_MAX_BYTES = 72;

/** Validates a new password: a string of 8 characters to 72 UTF-8 bytes. */
export function validatePassword(raw: unknown): string {
  if (typeof raw !== 'string') badRequest('Password must be a string.');
  if ([...raw].length < PASSWORD_MIN_LENGTH) {
    badRequest(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  }
  if (Buffer.byteLength(raw, 'utf8') > PASSWORD_MAX_BYTES) {
    badRequest(`Password must be at most ${PASSWORD_MAX_BYTES} bytes long.`);
  }
  return raw;
}
