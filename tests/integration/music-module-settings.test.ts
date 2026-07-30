import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/music-module.get';
import { createTestDb, insertSetting, mockEvent } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

describe('GET /api/settings/music-module', () => {
  it('returns enabled: true when the setting is missing entirely', async () => {
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(true);
  });

  it('returns enabled: true when the setting value is "1"', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(true);
  });

  it('returns enabled: false when the setting value is "0"', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(false);
  });

  it('returns enabled: true when database is unavailable (fail-open behavior)', async () => {
    (globalThis as any).getDb = () => {
      return {
        prepare: () => {
          throw new Error('Database is locked or unavailable');
        }
      };
    };
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(true);
  });
});
