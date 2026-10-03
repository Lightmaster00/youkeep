import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  getAdminDefaults,
  getUserOverrides,
  getDisplayView,
  saveUserOverrides,
  saveAdminDefaults,
  parseChangeOrThrow,
} from '../../server/utils/displayPrefsStore';
import { validatePartial, APP_DEFAULTS } from '../../shared/displayPrefs';
import { createTestDb, insertUser, insertSetting, insertUserPreferences } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

const row = (userId: string) => db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(userId) as { data: string } | undefined;
const change = (input: unknown) => validatePartial(input);

describe('getAdminDefaults / getUserOverrides', () => {
  it('return empty partials when nothing is stored', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    expect(getAdminDefaults(db)).toEqual({});
    expect(getUserOverrides(db, 'u1')).toEqual({});
  });

  it('read stored values', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertSetting(db, { key: 'display_defaults', value: '{"density":"compact"}' });
    insertUserPreferences(db, { userId: 'u1', data: '{"landingSpace":"music"}' });
    expect(getAdminDefaults(db)).toEqual({ density: 'compact' });
    expect(getUserOverrides(db, 'u1')).toEqual({ landingSpace: 'music' });
  });

  it('treat corrupt stored JSON as empty', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertSetting(db, { key: 'display_defaults', value: 'not json' });
    insertUserPreferences(db, { userId: 'u1', data: '{"density":"huge"}' });
    expect(getAdminDefaults(db)).toEqual({});
    expect(getUserOverrides(db, 'u1')).toEqual({});
  });

  it('getUserOverrides keeps valid keys when one stored key is invalid', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertUserPreferences(db, { userId: 'u1', data: '{"density":"huge","landingSpace":"music"}' });
    expect(getUserOverrides(db, 'u1')).toEqual({ landingSpace: 'music' });
  });

  it('never throw when the database is unavailable', () => {
    const broken = { prepare: () => { throw new Error('db down'); } } as unknown as Database.Database;
    expect(getAdminDefaults(broken)).toEqual({});
    expect(getUserOverrides(broken, 'u1')).toEqual({});
  });
});

describe('getDisplayView', () => {
  it('gives a guest the instance defaults and null overrides', () => {
    insertSetting(db, { key: 'display_defaults', value: '{"density":"spacious"}' });
    const view = getDisplayView(db, null);
    expect(view.overrides).toBeNull();
    expect(view.effective.density).toBe('spacious');
  });

  it('gives a user their overrides on top of the instance defaults', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertSetting(db, { key: 'display_defaults', value: '{"density":"spacious"}' });
    insertUserPreferences(db, { userId: 'u1', data: '{"density":"compact"}' });
    const view = getDisplayView(db, 'u1');
    expect(view.effective.density).toBe('compact');
    expect(view.defaults.density).toBe('spacious');
    expect(view.overrides).toEqual({ density: 'compact' });
  });
});

describe('saveUserOverrides', () => {
  it('stores only the changed keys', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    saveUserOverrides(db, 'u1', change({ density: 'compact' }));
    expect(JSON.parse(row('u1')!.data)).toEqual({ density: 'compact' });
  });

  it('merges with existing overrides and updates the row', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    saveUserOverrides(db, 'u1', change({ density: 'compact' }));
    saveUserOverrides(db, 'u1', change({ landingSpace: 'music' }));
    expect(JSON.parse(row('u1')!.data)).toEqual({ density: 'compact', landingSpace: 'music' });
  });

  it('removes a key with null and deletes the row once nothing is left', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    saveUserOverrides(db, 'u1', change({ density: 'compact', landingSpace: 'music' }));
    saveUserOverrides(db, 'u1', change({ density: null }));
    expect(JSON.parse(row('u1')!.data)).toEqual({ landingSpace: 'music' });
    saveUserOverrides(db, 'u1', change({ landingSpace: null }));
    expect(row('u1')).toBeUndefined();
  });

  it('replaces a corrupt stored value instead of failing', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertUserPreferences(db, { userId: 'u1', data: 'garbage' });
    saveUserOverrides(db, 'u1', change({ density: 'spacious' }));
    expect(JSON.parse(row('u1')!.data)).toEqual({ density: 'spacious' });
  });

  it('deletes the preferences row when the user is deleted (cascade)', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    saveUserOverrides(db, 'u1', change({ density: 'compact' }));
    db.prepare('DELETE FROM users WHERE id = ?').run('u1');
    expect(row('u1')).toBeUndefined();
  });
});

describe('saveAdminDefaults', () => {
  const stored = () => (db.prepare("SELECT value FROM settings WHERE key = 'display_defaults'").get() as { value: string } | undefined)?.value;

  it('creates, updates and finally removes the display_defaults setting', () => {
    saveAdminDefaults(db, change({ density: 'compact' }));
    expect(JSON.parse(stored()!)).toEqual({ density: 'compact' });
    saveAdminDefaults(db, change({ landingSpace: 'podcasts' }));
    expect(JSON.parse(stored()!)).toEqual({ density: 'compact', landingSpace: 'podcasts' });
    saveAdminDefaults(db, change({ density: null, landingSpace: null }));
    expect(stored()).toBeUndefined();
    expect(getDisplayView(db, null).effective).toEqual(APP_DEFAULTS);
  });
});

describe('parseChangeOrThrow', () => {
  it('returns the validated change', () => {
    expect(parseChangeOrThrow({ density: 'compact' }).set).toEqual({ density: 'compact' });
  });

  it('turns an invalid value into an h3 400', () => {
    expect(() => parseChangeOrThrow({ density: 'huge' })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('turns a non-object body into a 400', () => {
    expect(() => parseChangeOrThrow(null)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects a body with no recognised key with a 400', () => {
    expect(() => parseChangeOrThrow({ theme: 'light' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => parseChangeOrThrow({})).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('accepts a body that only removes keys', () => {
    expect(parseChangeOrThrow({ density: null }).remove).toEqual(['density']);
  });
});
