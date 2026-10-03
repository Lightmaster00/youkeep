import type Database from 'better-sqlite3';
import { createError } from 'h3';
import {
  InvalidPrefError,
  PREF_KEYS,
  applyChange,
  buildView,
  parseStoredPartial,
  validatePartial,
} from '../../shared/displayPrefs';
import type { DisplayView, PrefsPartial, ValidatedChange } from '../../shared/displayPrefs';

export const DISPLAY_DEFAULTS_KEY = 'display_defaults';

export function getAdminDefaults(db: Database.Database): PrefsPartial {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(DISPLAY_DEFAULTS_KEY) as { value: string } | undefined;
    return parseStoredPartial(row?.value);
  } catch {
    return {};
  }
}

export function getUserOverrides(db: Database.Database, userId: string): PrefsPartial {
  try {
    const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(userId) as { data: string } | undefined;
    return parseStoredPartial(row?.data);
  } catch {
    return {};
  }
}

// overrides is null for a guest, an object (possibly empty) for a logged-in user.
export function getDisplayView(db: Database.Database, userId: string | null): DisplayView {
  return buildView(getAdminDefaults(db), userId ? getUserOverrides(db, userId) : null);
}

export function saveUserOverrides(db: Database.Database, userId: string, change: ValidatedChange): void {
  const next = applyChange(getUserOverrides(db, userId), change);
  if (Object.keys(next).length === 0) {
    db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);
    return;
  }
  db.prepare(`
    INSERT INTO user_preferences (user_id, data, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(next), Date.now());
}

export function saveAdminDefaults(db: Database.Database, change: ValidatedChange): void {
  const next = applyChange(getAdminDefaults(db), change);
  if (Object.keys(next).length === 0) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(DISPLAY_DEFAULTS_KEY);
    return;
  }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(DISPLAY_DEFAULTS_KEY, JSON.stringify(next));
}

// Shared by the two write routes: invalid value / no recognised key → 400.
export function parseChangeOrThrow(body: unknown): ValidatedChange {
  let change: ValidatedChange;
  try {
    change = validatePartial(body);
  } catch (err) {
    if (err instanceof InvalidPrefError) {
      throw createError({ statusCode: 400, statusMessage: err.message });
    }
    throw err;
  }
  if (Object.keys(change.set).length === 0 && change.remove.length === 0) {
    throw createError({ statusCode: 400, statusMessage: `At least one display preference (${PREF_KEYS.join(', ')}) is required.` });
  }
  return change;
}
