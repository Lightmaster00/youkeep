import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/artists/[id]/index.get';
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

function eventFor(artistId: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/music/artists/${artistId}`, params: { id: artistId } });
}

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('GET /api/music/artists/[id]', () => {
  it('returns 404 for a nonexistent artist', async () => {
    await expect(handler(eventFor('missing'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 403 for a private artist requested by a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    await expect(handler(eventFor('a1'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns the artist and groups albums correctly for an accessible artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 2020 });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: null }); // standalone

    const result: any = await handler(eventFor('a1'));
    expect(result.artist.id).toBe('a1');
    expect(result.albums).toHaveLength(1);
    expect(result.albums[0].id).toBe('al1');
    expect(result.albums[0].track_count).toBe(2);
    expect(result.standaloneTrackCount).toBe(1);
  });

  it('only counts completed tracks in album track_count and standaloneTrackCount', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', downloadStatus: 'completed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al1', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: null, downloadStatus: 'failed' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums[0].track_count).toBe(1);
    expect(result.standaloneTrackCount).toBe(0);
  });

  it('omits an album with zero completed tracks entirely', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', downloadStatus: 'pending' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums).toHaveLength(0);
  });

  it('orders albums by release_year descending with nulls last', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'old', artistId: 'a1', releaseYear: 2000 });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'old' });
    insertMusicAlbum(db, { id: 'new', artistId: 'a1', releaseYear: 2020 });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'new' });
    insertMusicAlbum(db, { id: 'unknown', artistId: 'a1', releaseYear: null });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: 'unknown' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums.map((al: any) => al.id)).toEqual(['new', 'old', 'unknown']);
  });

  it("computes cover_url as the first completed track's thumbnail, ordered by track_number", async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al1', trackNumber: 2, localThumbnailPath: '/downloads-music/a1/t2.jpg' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', trackNumber: 1, localThumbnailPath: '/downloads-music/a1/t1.jpg' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums[0].cover_url).toBe('/downloads-music/a1/t1.jpg');
  });

  it('prefers a manually-set cover_url over the computed thumbnail fallback', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    db.prepare('UPDATE music_albums SET cover_url = ? WHERE id = ?').run('https://example.com/manual-cover.jpg', 'al1');
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', trackNumber: 1, localThumbnailPath: '/downloads-music/a1/t1.jpg' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums[0].cover_url).toBe('https://example.com/manual-cover.jpg');
  });

  it('exposes manual_cover_url as null when only the computed fallback applies', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', trackNumber: 1, localThumbnailPath: '/downloads-music/a1/t1.jpg' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums[0].manual_cover_url).toBeNull();
    expect(result.albums[0].cover_url).toBe('/downloads-music/a1/t1.jpg');
  });

  it('is accessible to an admin even for an ultra_private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    const cookie = loginAs('admin1', 'admin');
    const result: any = await handler(eventFor('a1', cookie));
    expect(result.artist.id).toBe('a1');
  });
});
