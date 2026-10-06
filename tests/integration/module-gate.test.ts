import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/middleware/moduleGate';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

// Path → module mapping is pinned in tests/unit/modules.test.ts (moduleForPath);
// this file covers the gate's rules: enabled/disabled, roles, fail-open, message.
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

const pass = async (path: string, cookie?: string) => expect(await handler(mockEvent(cookie, { path }))).toBeUndefined();
const blocked = (path: string, cookie?: string) => expect(handler(mockEvent(cookie, { path }))).rejects.toMatchObject({ statusCode: 404 });

describe('moduleGate middleware', () => {
  it('passes module routes when the setting is "1" or missing (defaults to enabled)', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    await pass('/api/music/artists');
    await pass('/downloads-music/GIMS/t1.opus');
    await pass('/api/podcasts/shows');
  });

  it.each([
    ['video', 'video_module_enabled', ['/api/videos/abc', '/api/channels', '/api/playlists', '/api/home/feed', '/downloads/chan/v.mp4']],
    ['music', 'music_module_enabled', ['/api/music', '/api/music/artists', '/downloads-music', '/downloads-music/GIMS/t1.opus']],
    ['podcasts', 'podcasts_module_enabled', ['/api/podcasts', '/downloads-podcasts/s/e.mp3']],
  ])('blocks every %s route with a 404 for a guest and a regular user when disabled', async (_name, key, paths) => {
    insertSetting(db, { key: key as string, value: '0' });
    const userCookie = loginAs('u1', 'user');
    for (const path of paths as string[]) {
      await blocked(path);
      await blocked(path, userCookie);
    }
  });

  it('uses the h3 unmatched-route 404 message, with the query string stripped', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/api/music/artists?x=1' }))).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Cannot find any route matching /api/music/artists.',
    });
  });

  it('lets an admin through a disabled module, by session cookie or by API token', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await pass('/api/music/artists', loginAs('admin1', 'admin'));
    const { createApiToken } = await import('../../server/utils/apiTokens');
    insertUser(db, { id: 'admin-token', role: 'admin' });
    const { token } = createApiToken('admin-token', 'cli');
    expect(await handler(mockEvent(undefined, { path: '/api/videos', headers: { authorization: `Bearer ${token}` } }))).toBeUndefined();
  });

  it('only blocks the disabled module: other modules (incl. /downloads-music, /downloads-podcasts) stay reachable', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    await pass('/api/music/artists');
    await pass('/downloads-music/a/t.opus');
    await pass('/downloads-podcasts/s/e.mp3');
  });

  it.each(['/api/auth/me', '/api/account/tokens', '/api/settings/modules', '/api/admin/music/ingest', '/api/admin/downloader/queue', '/api/musicfoo', '/login'])(
    'never gates %s even with every module flag at 0',
    async (path) => {
      insertSetting(db, { key: 'video_module_enabled', value: '0' });
      insertSetting(db, { key: 'music_module_enabled', value: '0' });
      insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
      await pass(path);
    }
  );

  it('fails open when the settings read throws', async () => {
    (globalThis as any).getDb = () => ({ prepare: () => { throw new Error('Database is locked or unavailable'); } });
    await pass('/api/music/artists');
  });

  it('fails open when getUserFromSession throws while the module is disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      if (sql.includes('FROM sessions')) throw new Error('Session lookup failed');
      return originalPrepare(sql);
    };
    try {
      await pass('/api/music/artists', sessionCookie('broken-session-id'));
    } finally {
      (db as any).prepare = originalPrepare;
    }
  });
});
