import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/middleware/moduleGate';
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

describe('moduleGate middleware — music', () => {
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

  it('uses the same 404 message h3 uses for a genuinely unmatched route', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/api/music/artists' }))).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Cannot find any route matching /api/music/artists.'
    });
  });

  it('gates the bare /api/music path (no trailing slash) when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/api/music' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('gates the bare /downloads-music path (no trailing slash) when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/downloads-music' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not gate lookalike paths that merely share the prefix', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const result = await handler(mockEvent(undefined, { path: '/api/musicfoo' }));
    expect(result).toBeUndefined();
  });

  it('strips the query string before matching, so a disabled module still blocks /api/music/artists?x=1', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/api/music/artists?x=1' }))).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Cannot find any route matching /api/music/artists.'
    });
  });

  it('fails open when getUserFromSession throws while the module is disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = sessionCookie('broken-session-id');
    (globalThis as any).getDb = () => db;
    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      if (sql.includes('FROM sessions')) {
        throw new Error('Session lookup failed');
      }
      return originalPrepare(sql);
    };
    const result = await handler(mockEvent(cookie, { path: '/api/music/artists' }));
    expect(result).toBeUndefined();
    (db as any).prepare = originalPrepare;
  });
});

describe('moduleGate middleware — video and podcasts', () => {
  it.each([
    ['video', 'video_module_enabled', ['/api/videos', '/api/videos/abc', '/api/channels', '/api/channels/c1', '/api/playlists', '/api/home/feed', '/downloads', '/downloads/chan/v.mp4']],
    ['podcasts', 'podcasts_module_enabled', ['/api/podcasts', '/api/podcasts/shows', '/downloads-podcasts', '/downloads-podcasts/s/e.mp3']],
  ])('blocks every %s route with a 404 for a guest and a regular user when disabled', async (_name, key, paths) => {
    insertSetting(db, { key: key as string, value: '0' });
    const userCookie = loginAs('u1', 'user');
    for (const path of paths as string[]) {
      await expect(handler(mockEvent(undefined, { path }))).rejects.toMatchObject({ statusCode: 404 });
      await expect(handler(mockEvent(userCookie, { path }))).rejects.toMatchObject({ statusCode: 404 });
    }
  });

  it.each([
    ['video_module_enabled', '/api/videos'],
    ['podcasts_module_enabled', '/api/podcasts/shows'],
  ])('lets an admin through when %s is 0', async (key, path) => {
    insertSetting(db, { key, value: '0' });
    const cookie = loginAs('admin1', 'admin');
    expect(await handler(mockEvent(cookie, { path }))).toBeUndefined();
  });

  it('lets an admin through using an API token (no cookie) when the module is disabled', async () => {
    const { createApiToken } = await import('../../server/utils/apiTokens');
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertUser(db, { id: 'admin-token', role: 'admin' });
    const { token } = createApiToken('admin-token', 'cli');
    const event = mockEvent(undefined, { path: '/api/videos', headers: { authorization: `Bearer ${token}` } });
    expect(await handler(event)).toBeUndefined();
  });

  it('uses the h3 404 message for the module it blocked', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/api/videos/abc' }))).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Cannot find any route matching /api/videos/abc.',
    });
  });

  it('only blocks the disabled module: other modules stay reachable', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    expect(await handler(mockEvent(undefined, { path: '/api/music/artists' }))).toBeUndefined();
    expect(await handler(mockEvent(undefined, { path: '/api/podcasts/shows' }))).toBeUndefined();
  });

  it('does not let a disabled video module block /downloads-music or /downloads-podcasts', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    expect(await handler(mockEvent(undefined, { path: '/downloads-music/a/t.opus' }))).toBeUndefined();
    expect(await handler(mockEvent(undefined, { path: '/downloads-podcasts/s/e.mp3' }))).toBeUndefined();
  });

  it.each(['/api/auth/me', '/api/account/tokens', '/api/settings/modules', '/api/admin/downloader/queue', '/login'])(
    'never gates %s even with every module flag at 0',
    async (path) => {
      insertSetting(db, { key: 'video_module_enabled', value: '0' });
      insertSetting(db, { key: 'music_module_enabled', value: '0' });
      insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
      expect(await handler(mockEvent(undefined, { path }))).toBeUndefined();
    }
  );
});
