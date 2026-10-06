import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/artists/[id]/tracks.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicAlbum,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function eventFor(artistId: string, query: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/music/artists/${artistId}/tracks${query}`, params: { id: artistId } });
}

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

const ids = (r: any) => r.tracks.map((t: any) => t.id);

describe('GET /api/music/artists/[id]/tracks', () => {
  it('returns 404 for a nonexistent artist, 403 for a private artist requested by a guest, 400 without albumId', async () => {
    await expect(handler(eventFor('missing', '?albumId=none'))).rejects.toMatchObject({ statusCode: 404 });
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    await expect(handler(eventFor('a1', '?albumId=none'))).rejects.toMatchObject({ statusCode: 403 });
    insertMusicArtist(db, { id: 'a2' });
    await expect(handler(eventFor('a2', ''))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('is accessible to an admin even for an ultra_private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: null });
    const result: any = await handler(eventFor('a1', '?albumId=none', loginAs('admin1', 'admin')));
    expect(ids(result)).toEqual(['t1']);
  });

  it('scopes to one album, to album-less tracks with albumId=none, and returns nothing for another artist\'s album', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicAlbum(db, { id: 'al2', artistId: 'a1' });
    insertMusicAlbum(db, { id: 'al-of-a2', artistId: 'a2' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al2' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: null });
    insertMusicTrack(db, { id: 't4', artistId: 'a2', albumId: 'al-of-a2' });

    expect(await handler(eventFor('a1', '?albumId=al1'))).toMatchObject({ total: 1, tracks: [{ id: 't1' }] });
    expect(ids(await handler(eventFor('a1', '?albumId=none')))).toEqual(['t3']);
    expect(await handler(eventFor('a1', '?albumId=al-of-a2'))).toEqual({ tracks: [], total: 0 });
  });

  it('returns only completed tracks with the playback fields (local_file_path, artist_name, has_clip)', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Test Artist' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: null, localFilePath: '/downloads-music/a1/t1.opus', hasClip: true });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: null, hasClip: false });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: null, downloadStatus: 'pending' });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.total).toBe(2);
    const byId = Object.fromEntries(result.tracks.map((t: any) => [t.id, t]));
    expect(byId.t1).toMatchObject({ local_file_path: '/downloads-music/a1/t1.opus', artist_name: 'Test Artist', has_clip: 1 });
    expect(byId.t2.has_clip).toBe(0);
    expect(byId.t3).toBeUndefined();
  });

  it('orders by track_number ascending with nulls last, then title', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 'no-number', artistId: 'a1', albumId: null, trackNumber: null });
    insertMusicTrack(db, { id: 'two', artistId: 'a1', albumId: null, trackNumber: 2 });
    insertMusicTrack(db, { id: 'one', artistId: 'a1', albumId: null, trackNumber: 1 });
    expect(ids(await handler(eventFor('a1', '?albumId=none')))).toEqual(['one', 'two', 'no-number']);
  });

  it('paginates with limit and offset, defaults to limit=50 and caps limit at 200', async () => {
    insertMusicArtist(db, { id: 'a1' });
    for (let i = 1; i <= 250; i++) {
      insertMusicTrack(db, { id: `t${i}`, artistId: 'a1', albumId: null, trackNumber: i });
    }
    expect(await handler(eventFor('a1', '?albumId=none&limit=2&offset=2'))).toMatchObject({ total: 250, tracks: [{ id: 't3' }, { id: 't4' }] });
    expect((await handler(eventFor('a1', '?albumId=none')) as any).tracks).toHaveLength(50);
    expect((await handler(eventFor('a1', '?albumId=none&limit=999999999')) as any).tracks).toHaveLength(200);
  });
});
