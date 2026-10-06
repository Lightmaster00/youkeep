import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import pauseHandler from '../../server/api/admin/music/artists/[id]/pause.post';
import { requireAdmin } from '../../server/utils/auth';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('POST /api/admin/music/artists/:id/pause', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(pauseHandler(mockEvent(undefined, { path: '/api/admin/music/artists/a1/pause', params: { id: 'a1' } }))).rejects.toMatchObject({ statusCode: 401 });
    const cookie = loginAs('u1', 'user');
    await expect(pauseHandler(mockEvent(cookie, { path: '/api/admin/music/artists/a1/pause', params: { id: 'a1' } }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 when the artist does not exist', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(pauseHandler(mockEvent(cookie, { path: '/api/admin/music/artists/nope/pause', params: { id: 'nope' } }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('flips sync_status to paused for an existing artist', async () => {
    insertMusicArtist(db, { id: 'a1' });
    db.prepare("UPDATE music_artists SET sync_status = 'downloading' WHERE id = 'a1'").run();

    const cookie = loginAs('admin1', 'admin');
    const result: any = await pauseHandler(mockEvent(cookie, { path: '/api/admin/music/artists/a1/pause', params: { id: 'a1' } }));

    expect(result.success).toBe(true);
    const row = db.prepare("SELECT sync_status FROM music_artists WHERE id = 'a1'").get() as any;
    expect(row.sync_status).toBe('paused');
  });
});
