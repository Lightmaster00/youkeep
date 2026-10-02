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

describe('isModuleEnabled', () => {
  it('is enabled when the setting row is missing', () => {
    expect(isModuleEnabled(db, 'video')).toBe(true);
    expect(isModuleEnabled(db, 'podcasts')).toBe(true);
  });

  it('is enabled for "1" and disabled for "0"', () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    expect(isModuleEnabled(db, 'music')).toBe(true);
    expect(isModuleEnabled(db, 'video')).toBe(false);
  });

  it('fails open (enabled) when the read throws', () => {
    const broken = { prepare: () => { throw new Error('db unavailable'); } } as unknown as Database.Database;
    expect(isModuleEnabled(broken, 'music')).toBe(true);
  });
});

describe('getModuleStates', () => {
  it('returns all three states', () => {
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    expect(getModuleStates(db)).toEqual({ video: true, music: true, podcasts: false });
  });
});

describe('setModulesEnabled', () => {
  it('creates missing rows and updates existing ones', () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    setModulesEnabled(db, { music: false, podcasts: false });
    expect(value('music_module_enabled')).toBe('0');
    expect(value('podcasts_module_enabled')).toBe('0');
    expect(value('video_module_enabled')).toBeUndefined();
  });

  it('re-enables a module', () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    setModulesEnabled(db, { music: true });
    expect(value('music_module_enabled')).toBe('1');
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

  it('allows swapping which module is the enabled one in a single call', () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    setModulesEnabled(db, { podcasts: false, video: true });
    expect(value('podcasts_module_enabled')).toBe('0');
    expect(value('video_module_enabled')).toBe('1');
  });
});

describe('isEffectivelyPaused', () => {
  it('is false when not paused and the module is enabled', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '0' });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(false);
  });

  it('is true when the admin paused it', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '1' });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(true);
  });

  it('is true when the module is disabled, without touching the admin pause flag', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '0' });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(true);
    expect(value('music_downloader_paused')).toBe('0');
  });

  it('resumes exactly to the admin choice once re-enabled', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '0' });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    setModulesEnabled(db, { music: true });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(false);
  });
});
