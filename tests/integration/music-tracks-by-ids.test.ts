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
  it('returns 400 when ids is missing or not an array', async () => {
    await expect(handler(eventFor(undefined))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('not-an-array'))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns an empty list for an empty ids array', async () => {
    const result: any = await handler(eventFor([]));
    expect(result.tracks).toEqual([]);
  });

  it('returns matching tracks preserving the requested order', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', localFilePath: '/downloads-music/a1/t1.m4a' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', localFilePath: '/downloads-music/a1/t2.m4a' });

    const result: any = await handler(eventFor(['t2', 't1']));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t2', 't1']);
    expect(result.tracks[0].local_file_path).toBe('/downloads-music/a1/t2.m4a');
  });

  it('silently drops ids that do not exist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await handler(eventFor(['t1', 'missing']));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes tracks the requester cannot access', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await handler(eventFor(['t1']));
    expect(result.tracks).toEqual([]);
  });

  it('includes an ultra_private track for an admin', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor(['t1'], cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes tracks that are not completed', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'pending' });

    const result: any = await handler(eventFor(['t1']));
    expect(result.tracks).toEqual([]);
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
    expect(result.tracks.length).toBeLessThanOrEqual(200);
  });
});
