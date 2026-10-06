import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/tracks/by-ids.post';
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

function eventFor(ids: any, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: '/api/music/tracks/by-ids', body: { ids } });
}

describe('POST /api/music/tracks/by-ids', () => {
  it('returns 400 when ids is missing or not an array, and an empty list for an empty array', async () => {
    await expect(handler(eventFor(undefined))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('not-an-array'))).rejects.toMatchObject({ statusCode: 400 });
    expect((await handler(eventFor([])) as any).tracks).toEqual([]);
  });

  it('returns completed, existing tracks in the requested order with playback fields and has_clip', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', localFilePath: '/downloads-music/a1/t1.m4a', hasClip: true });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', localFilePath: '/downloads-music/a1/t2.m4a', hasClip: false });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', downloadStatus: 'pending' });

    const result: any = await handler(eventFor(['t2', 'missing', 't3', 't1']));
    expect(result.tracks.map((t: any) => [t.id, t.local_file_path, t.has_clip])).toEqual([
      ['t2', '/downloads-music/a1/t2.m4a', 0],
      ['t1', '/downloads-music/a1/t1.m4a', 1],
    ]);
  });

  it('excludes tracks the requester cannot access; an admin gets ultra_private ones', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect((await handler(eventFor(['t1'])) as any).tracks).toEqual([]);
    const cookie = loginAs('admin1', 'admin');
    expect((await handler(eventFor(['t1'], cookie)) as any).tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('caps the number of ids processed at 200', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    const ids: string[] = [];
    for (let i = 0; i < 250; i++) {
      const id = `t${i}`;
      insertMusicTrack(db, { id, artistId: 'a1' });
      ids.push(id);
    }

    const result: any = await handler(eventFor(ids));
    expect(result.tracks.map((t: any) => t.id)).toEqual(ids.slice(0, 200));
  });
});
