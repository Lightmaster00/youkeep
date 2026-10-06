import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/tracks/[id]/play.post';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

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

function eventFor(trackId: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/music/tracks/${trackId}/play`, params: { id: trackId } });
}

describe('POST /api/music/tracks/[id]/play', () => {
  it('returns 404 for a nonexistent track, 403 for a private track to a guest and for an ultra_private one to a user', async () => {
    const cookie = loginAs('u1');
    await expect(handler(eventFor('missing', cookie))).rejects.toMatchObject({ statusCode: 404 });
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    await expect(handler(eventFor('t1'))).rejects.toMatchObject({ statusCode: 403 });
    insertMusicArtist(db, { id: 'a2', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2' });
    await expect(handler(eventFor('t2', cookie))).rejects.toMatchObject({ statusCode: 403 });
    expect(((await handler(eventFor('t2', loginAs('admin1', 'admin')))) as any).recorded).toBe(true);
  });

  it('does not record a play and returns recorded:false for a guest on a public track', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await handler(eventFor('t1'));
    expect(result.recorded).toBe(false);
    const rows = db.prepare('SELECT COUNT(*) as cnt FROM music_play_history').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  it('records one new row per play for a logged-in user (no upserted count)', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');

    expect(((await handler(eventFor('t1', cookie))) as any).recorded).toBe(true);
    await handler(eventFor('t1', cookie));
    const rows = db.prepare('SELECT track_id, user_id FROM music_play_history').all() as any[];
    expect(rows).toEqual([{ track_id: 't1', user_id: 'u1' }, { track_id: 't1', user_id: 'u1' }]);
  });
});
