import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  isModuleEnabled,
  getModuleStates,
  setModulesEnabled,
  isEffectivelyPaused,
  LastModuleError,
} from '../../server/utils/modules';
import { createTestDb, insertSetting } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

const value = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;

describe('isModuleEnabled / getModuleStates', () => {
  it('is enabled when the row is missing or "1", disabled for "0"', () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    expect(getModuleStates(db)).toEqual({ video: true, music: true, podcasts: false });
    expect(isModuleEnabled(db, 'podcasts')).toBe(false);
  });

  it('fails open (enabled) when the read throws', () => {
    const broken = { prepare: () => { throw new Error('db unavailable'); } } as unknown as Database.Database;
    expect(isModuleEnabled(broken, 'music')).toBe(true);
  });
});

describe('setModulesEnabled', () => {
  it('creates missing rows, updates existing ones and leaves unmentioned modules alone', () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    setModulesEnabled(db, { music: false, podcasts: false, video: true });
    expect(value('music_module_enabled')).toBe('0');
    expect(value('podcasts_module_enabled')).toBe('0');
    expect(value('video_module_enabled')).toBe('1');
  });

  it('refuses to disable the last enabled module and writes nothing', () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    expect(() => setModulesEnabled(db, { music: false })).toThrow(LastModuleError);
    expect(value('music_module_enabled')).toBeUndefined();
  });

  it('refuses a single call that would disable everything, and writes nothing (atomic)', () => {
    expect(() => setModulesEnabled(db, { video: false, music: false, podcasts: false })).toThrow(LastModuleError);
    expect(value('video_module_enabled')).toBeUndefined();
    expect(value('music_module_enabled')).toBeUndefined();
    expect(value('podcasts_module_enabled')).toBeUndefined();
  });
});

describe('isEffectivelyPaused', () => {
  it('is the admin pause flag when the module is enabled', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '0' });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(false);
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'music_downloader_paused'").run();
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(true);
  });

  it('is true while the module is disabled without touching the pause flag, and resumes to the admin choice', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '0' });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(true);
    expect(value('music_downloader_paused')).toBe('0');
    setModulesEnabled(db, { music: true });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(false);
  });
});
