import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/middleware/musicModuleGate';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('musicModuleGate middleware', () => {
  it('passes through non-music paths regardless of the setting', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const result = await handler(mockEvent(undefined, { path: '/api/channels' }));
    expect(result).toBeUndefined();
  });

  it('passes through /api/music/* for a guest when enabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const result = await handler(mockEvent(undefined, { path: '/api/music/artists' }));
    expect(result).toBeUndefined();
  });

  it('passes through /downloads-music/* for a guest when enabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const result = await handler(mockEvent(undefined, { path: '/downloads-music/GIMS/t1.opus' }));
    expect(result).toBeUndefined();
  });

  it('passes through when the setting is missing entirely (defaults to enabled)', async () => {
    const result = await handler(mockEvent(undefined, { path: '/api/music/artists' }));
    expect(result).toBeUndefined();
  });

  it('blocks /api/music/* for a guest with a 404 when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/api/music/artists' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('blocks /downloads-music/* for a guest with a 404 when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/downloads-music/GIMS/t1.opus' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('blocks /api/music/* for a logged-in non-admin when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = loginAs('u1', 'user');
    await expect(handler(mockEvent(cookie, { path: '/api/music/artists' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('passes through /api/music/* for an admin even when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = loginAs('admin1', 'admin');
    const result = await handler(mockEvent(cookie, { path: '/api/music/artists' }));
    expect(result).toBeUndefined();
  });

  it('does not gate /api/admin/music/* at all (untouched by this middleware)', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const result = await handler(mockEvent(undefined, { path: '/api/admin/music/ingest' }));
    expect(result).toBeUndefined();
  });

  it('passes through /api/music/* for a guest when the settings read throws (fail-open)', async () => {
    (globalThis as any).getDb = () => {
      return {
        prepare: () => {
          throw new Error('Database is locked or unavailable');
        }
      };
    };
    const result = await handler(mockEvent(undefined, { path: '/api/music/artists' }));
    expect(result).toBeUndefined();
  });
});
