import { createError, readBody, type H3Event } from 'h3';
import type Database from 'better-sqlite3';
import { Cron } from 'croner';

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

/**
 * Like readJsonObject for routes whose body is optional: no body (or an empty
 * one) is `{}`; anything present must still be a JSON object.
 */
export async function readOptionalJsonObject(event: H3Event): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await readBody(event, { strict: true });
  } catch {
    badRequest('The request body must be a JSON object.');
  }
  if (body === undefined || body === '') return {};
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

/** Required non-empty string field (trimmed): 400 when missing, empty, not a string or too long. */
export function requiredString(body: Record<string, unknown>, key: string, opts: { max: number; trim?: boolean }): string {
  const value = optionalString(body, key, opts);
  if (!value) badRequest(`${key} is required.`);
  return value;
}

/** Optional boolean field (true/false, or 0/1): undefined when absent or null, 400 otherwise. */
export function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  badRequest(`${key} must be true or false.`);
}

/** Optional field restricted to `allowed` values: undefined when absent or null, 400 otherwise. */
export function optionalEnum<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    badRequest(`${key} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

/** Optional integer field within [min, max]: undefined when absent or null, 400 otherwise. */
export function optionalInteger(body: Record<string, unknown>, key: string, opts: { min: number; max: number }): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < opts.min || value > opts.max) {
    badRequest(`${key} must be an integer between ${opts.min} and ${opts.max}.`);
  }
  return value;
}

/**
 * A URL field: required, at most 2048 characters, no control characters, and a
 * real http(s) URL without embedded credentials. Anything else (for example a
 * value starting with "--") could be read by yt-dlp as an option, so it is
 * refused here instead of being passed on.
 */
export function requiredUrl(body: Record<string, unknown>, key: string): string {
  const value = requiredString(body, key, { max: 2048 });
  if (/[\u0000-\u001f\u007f]/.test(value)) badRequest(`${key} contains invalid characters.`);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return badRequest(`${key} must be an http(s) URL.`);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) {
    badRequest(`${key} must be an http(s) URL without credentials.`);
  }
  return value;
}

/** Automatic syncs run at most this often (each one lists every source on YouTube or its feed). */
export const MIN_CRON_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Why `schedule` cannot be used for an automatic sync, or null when it can:
 * it must be a valid 5-field cron expression (or a nickname such as @daily;
 * no seconds field, which ran a sync every second) whose next runs are at
 * least MIN_CRON_INTERVAL_MS apart.
 */
export function cronScheduleProblem(schedule: string): string | null {
  const trimmed = String(schedule ?? '').trim();
  let runs: Date[];
  try {
    const job = new Cron(trimmed, { paused: true });
    runs = job.nextRuns(3);
    job.stop();
  } catch {
    return 'Invalid cron expression.';
  }
  if (!trimmed.startsWith('@') && trimmed.split(/\s+/).length !== 5) {
    return 'Use a cron expression with 5 fields (minute hour day month weekday); seconds are not supported.';
  }
  if (runs.length === 0) return 'Invalid cron expression.';
  for (let i = 1; i < runs.length; i++) {
    if (runs[i]!.getTime() - runs[i - 1]!.getTime() < MIN_CRON_INTERVAL_MS) {
      return 'The schedule must not run more often than every 10 minutes.';
    }
  }
  return null;
}

/**
 * The cron expression to schedule at startup, or null: a stored schedule that
 * the current rules refuse (saved by an older version) is disabled, with a
 * log line, instead of running.
 */
export function usableStoredSchedule(db: { prepare: (sql: string) => any }, enabledKey: string, schedule: string, label: string): string | null {
  const problem = cronScheduleProblem(schedule);
  if (!problem) return schedule.trim();
  console.warn(`[scheduler] The ${label} sync schedule "${schedule}" was disabled: ${problem}`);
  try {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, '0') ON CONFLICT(key) DO UPDATE SET value = '0'").run(enabledKey);
  } catch (err) {
    console.error(`[scheduler] Could not disable the ${label} sync schedule:`, err);
  }
  return null;
}

/**
 * The body of the three schedule routes: { enabled, schedule }. When enabled,
 * the schedule must be a usable cron expression (cronScheduleProblem; 400
 * otherwise, the parser's own error text never reaches the client).
 */
export function readScheduleFields(body: Record<string, unknown>): { enabled: boolean; schedule: string | undefined } {
  const enabled = optionalBoolean(body, 'enabled') ?? false;
  const schedule = optionalString(body, 'schedule', { max: 100 }) || undefined;
  if (enabled && !schedule) badRequest('Cron schedule expression is required when enabled.');
  if (schedule) {
    const problem = cronScheduleProblem(schedule);
    if (problem) badRequest(problem);
  }
  return { enabled, schedule };
}

export const SYNC_STATUSES = ['downloading', 'paused'] as const;
export const VISIBILITIES = ['public', 'private', 'ultra_private'] as const;

/**
 * An upstream service (yt-dlp, a feed host, a search API) failed: 502 with a
 * generic message; the details go to the server log only.
 */
export function upstreamFailure(context: string, err: unknown, message = 'The remote source could not be reached or returned an error.'): never {
  console.error(`[${context}]`, err);
  throw createError({ statusCode: 502, statusMessage: message });
}

/** True for an error already shaped for the client (has a 4xx/5xx statusCode). */
export function isHttpError(err: unknown): err is { statusCode: number } {
  return typeof err === 'object' && err !== null && typeof (err as any).statusCode === 'number';
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
