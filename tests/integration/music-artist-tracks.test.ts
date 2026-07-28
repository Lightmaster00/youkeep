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

describe('GET /api/music/artists/[id]/tracks', () => {
  it('returns 404 for a nonexistent artist', async () => {
    await expect(handler(eventFor('missing', '?albumId=none'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 403 for a private artist requested by a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    await expect(handler(eventFor('a1', '?albumId=none'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 when albumId is missing', async () => {
    insertMusicArtist(db, { id: 'a1' });
    await expect(handler(eventFor('a1', ''))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns tracks scoped to one album', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicAlbum(db, { id: 'al2', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al2' });

    const result: any = await handler(eventFor('a1', '?albumId=al1'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
    expect(result.total).toBe(1);
  });

  it("returns album-less tracks when albumId=none", async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: null });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t2']);
  });

  it('only returns completed tracks', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: null, downloadStatus: 'completed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: null, downloadStatus: 'pending' });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
    expect(result.total).toBe(1);
  });

  it('returns empty results for an albumId that does not belong to the artist, without erroring', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicAlbum(db, { id: 'al-of-a2', artistId: 'a2' });
    insertMusicTrack(db, { id: 't1', artistId: 'a2', albumId: 'al-of-a2' });

    const result: any = await handler(eventFor('a1', '?albumId=al-of-a2'));
    expect(result.tracks).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('orders by track_number ascending with nulls last, then title', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 'no-number', artistId: 'a1', albumId: null, trackNumber: null });
    insertMusicTrack(db, { id: 'two', artistId: 'a1', albumId: null, trackNumber: 2 });
    insertMusicTrack(db, { id: 'one', artistId: 'a1', albumId: null, trackNumber: 1 });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['one', 'two', 'no-number']);
  });

  it('paginates with limit and offset, respecting total across pages', async () => {
    insertMusicArtist(db, { id: 'a1' });
    for (let i = 1; i <= 5; i++) {
      insertMusicTrack(db, { id: `t${i}`, artistId: 'a1', albumId: null, trackNumber: i });
    }

    const page1: any = await handler(eventFor('a1', '?albumId=none&limit=2&offset=0'));
    expect(page1.tracks.map((t: any) => t.id)).toEqual(['t1', 't2']);
    expect(page1.total).toBe(5);

    const page2: any = await handler(eventFor('a1', '?albumId=none&limit=2&offset=2'));
    expect(page2.tracks.map((t: any) => t.id)).toEqual(['t3', 't4']);
    expect(page2.total).toBe(5);
  });

  it('defaults to limit=50 when not provided', async () => {
    insertMusicArtist(db, { id: 'a1' });
    for (let i = 1; i <= 60; i++) {
      insertMusicTrack(db, { id: `t${i}`, artistId: 'a1', albumId: null, trackNumber: i });
    }

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks).toHaveLength(50);
    expect(result.total).toBe(60);
  });

  it('is accessible to an admin even for an ultra_private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: null });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('a1', '?albumId=none', cookie));
    expect(result.tracks).toHaveLength(1);
  });
});
