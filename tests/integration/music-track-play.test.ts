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
  it('returns 404 for a nonexistent track', async () => {
    const cookie = loginAs('u1');
    await expect(handler(eventFor('missing', cookie))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 403 for a private track requested by a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    await expect(handler(eventFor('t1'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('does not record a play and returns recorded:false for a guest on a public track', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await handler(eventFor('t1'));
    expect(result.recorded).toBe(false);
    const rows = db.prepare('SELECT COUNT(*) as cnt FROM music_play_history').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  it('records a play for a logged-in user on an accessible track', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');

    const result: any = await handler(eventFor('t1', cookie));
    expect(result.recorded).toBe(true);
    const rows = db.prepare('SELECT track_id, user_id FROM music_play_history').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].track_id).toBe('t1');
    expect(rows[0].user_id).toBe('u1');
  });

  it('inserts a new row on each call rather than upserting a count', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');

    await handler(eventFor('t1', cookie));
    await handler(eventFor('t1', cookie));
    const rows = db.prepare('SELECT COUNT(*) as cnt FROM music_play_history').get() as { cnt: number };
    expect(rows.cnt).toBe(2);
  });

  it('returns 403 for a logged-in user on an ultra_private track they cannot access', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');
    await expect(handler(eventFor('t1', cookie))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('records a play for an admin on an ultra_private track', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', cookie));
    expect(result.recorded).toBe(true);
  });
});
