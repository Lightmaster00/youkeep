import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import overviewHandler from '../../server/api/music/artists/[id]/overview.get';
import songsHandler from '../../server/api/music/artists/[id]/songs.get';
import albumHandler from '../../server/api/music/albums/[id].get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicAlbum,
  insertMusicTrack,
  insertMusicPlay,
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

const overview = (artistId: string, cookie?: string) =>
  overviewHandler(mockEvent(cookie, { path: `/api/music/artists/${artistId}/overview`, params: { id: artistId } })) as Promise<any>;
const songs = (artistId: string, query = '', cookie?: string) =>
  songsHandler(mockEvent(cookie, { path: `/api/music/artists/${artistId}/songs${query}`, params: { id: artistId } })) as Promise<any>;
const album = (albumId: string, cookie?: string) =>
  albumHandler(mockEvent(cookie, { path: `/api/music/albums/${albumId}`, params: { id: albumId } })) as Promise<any>;
const ids = (list: any[]) => list.map((x) => x.id);

describe('GET /api/music/artists/[id]/overview', () => {
  it('returns 404 for a missing artist, 403 for a guest on a private artist, and admits an admin on ultra_private', async () => {
    await expect(overview('missing')).rejects.toMatchObject({ statusCode: 404 });
    insertMusicArtist(db, { id: 'priv', visibility: 'private' });
    await expect(overview('priv')).rejects.toMatchObject({ statusCode: 403 });
    insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
    await expect(overview('ultra', loginAs('member'))).rejects.toMatchObject({ statusCode: 403 });
    const result = await overview('ultra', loginAs('boss', 'admin'));
    expect(result.artist.id).toBe('ultra');
  });

  it('orders popular tracks by views (unknown last), then by the caller\'s own plays, then by title, at most 5', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 'low', artistId: 'a1', title: 'Low', viewCount: 10 });
    insertMusicTrack(db, { id: 'high', artistId: 'a1', title: 'High', viewCount: 5000 });
    insertMusicTrack(db, { id: 'n-b', artistId: 'a1', title: 'Bravo', viewCount: null });
    insertMusicTrack(db, { id: 'n-a', artistId: 'a1', title: 'Alpha', viewCount: null });
    insertMusicTrack(db, { id: 'n-played', artistId: 'a1', title: 'Zulu', viewCount: null });
    insertMusicTrack(db, { id: 'n-c', artistId: 'a1', title: 'Charlie', viewCount: null });
    insertMusicTrack(db, { id: 'pending', artistId: 'a1', title: 'Pending', viewCount: 999999, downloadStatus: 'pending' });

    const guest = await overview('a1');
    expect(ids(guest.popular)).toEqual(['high', 'low', 'n-a', 'n-b', 'n-c']);

    const cookie = loginAs('u1');
    insertUser(db, { id: 'other', role: 'user' });
    insertMusicPlay(db, { id: 'p1', trackId: 'n-played', userId: 'u1' });
    insertMusicPlay(db, { id: 'p2', trackId: 'n-played', userId: 'u1' });
    insertMusicPlay(db, { id: 'p3', trackId: 'n-b', userId: 'u1' });
    // Someone else's plays never count for this user.
    for (let i = 0; i < 5; i++) insertMusicPlay(db, { id: `o${i}`, trackId: 'n-c', userId: 'other' });
    const mine = await overview('a1', cookie);
    expect(ids(mine.popular)).toEqual(['high', 'low', 'n-played', 'n-b', 'n-a']);
  });

  it('splits albums from singles/EPs, newest year first, leaving out albums without a completed track', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'old', artistId: 'a1', releaseYear: 2001, albumType: 'album' });
    insertMusicAlbum(db, { id: 'new', artistId: 'a1', releaseYear: 2020, albumType: null });
    insertMusicAlbum(db, { id: 'noyear', artistId: 'a1', releaseYear: null });
    insertMusicAlbum(db, { id: 'single', artistId: 'a1', releaseYear: 2022, albumType: 'single' });
    insertMusicAlbum(db, { id: 'ep', artistId: 'a1', releaseYear: 2019, albumType: 'ep' });
    insertMusicAlbum(db, { id: 'empty', artistId: 'a1', releaseYear: 2024, albumType: 'album' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'old' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'new' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: 'new' });
    insertMusicTrack(db, { id: 't4', artistId: 'a1', albumId: 'noyear' });
    insertMusicTrack(db, { id: 't5', artistId: 'a1', albumId: 'single' });
    insertMusicTrack(db, { id: 't6', artistId: 'a1', albumId: 'ep' });
    insertMusicTrack(db, { id: 't7', artistId: 'a1', albumId: 'empty', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 't8', artistId: 'a1', albumId: null });

    const result = await overview('a1');
    expect(ids(result.albums)).toEqual(['new', 'old', 'noyear']);
    expect(result.albums[0].track_count).toBe(2);
    expect(ids(result.singles)).toEqual(['single', 'ep']);
    expect(result.counts).toEqual({ tracks: 7, albums: 3, singles: 2 });
  });

  it('picks the newest album or single as the latest release, by year then creation time', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'y2020-early', artistId: 'a1', releaseYear: 2020, createdAt: 1000 });
    insertMusicAlbum(db, { id: 'y2020-late', artistId: 'a1', releaseYear: 2020, createdAt: 2000, albumType: 'single' });
    insertMusicAlbum(db, { id: 'y2010', artistId: 'a1', releaseYear: 2010, createdAt: 9000 });
    insertMusicAlbum(db, { id: 'noyear', artistId: 'a1', releaseYear: null, createdAt: 9999 });
    for (const al of ['y2020-early', 'y2020-late', 'y2010', 'noyear']) {
      insertMusicTrack(db, { id: `t-${al}`, artistId: 'a1', albumId: al });
    }
    const result = await overview('a1');
    expect(result.latest.kind).toBe('album');
    expect(result.latest.album.id).toBe('y2020-late');
    expect(result.latest.track).toBeUndefined();
  });

  it('falls back to the newest track by upload date then creation time when there is no album, and null when empty', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 'old', artistId: 'a1', uploadDate: '20190101', createdAt: 9000 });
    insertMusicTrack(db, { id: 'new', artistId: 'a1', uploadDate: '20230505', createdAt: 1000 });
    insertMusicTrack(db, { id: 'undated', artistId: 'a1', uploadDate: null, createdAt: 99999 });
    insertMusicTrack(db, { id: 'pending', artistId: 'a1', uploadDate: '20250101', downloadStatus: 'pending' });
    const result = await overview('a1');
    expect(result.latest.kind).toBe('track');
    expect(result.latest.track.id).toBe('new');
    expect(result.latest.album).toBeUndefined();

    insertMusicArtist(db, { id: 'empty' });
    expect((await overview('empty')).latest).toBeNull();
  });
});

describe('GET /api/music/artists/[id]/songs', () => {
  beforeEach(() => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 'b', artistId: 'a1', albumId: 'al1', title: 'beta', viewCount: 50, uploadDate: '20200101', createdAt: 3 });
    insertMusicTrack(db, { id: 'a', artistId: 'a1', title: 'Alpha', viewCount: 900, uploadDate: '20180101', createdAt: 2 });
    insertMusicTrack(db, { id: 'c', artistId: 'a1', title: 'Charlie', viewCount: null, uploadDate: null, createdAt: 9 });
    insertMusicTrack(db, { id: 'd', artistId: 'a1', title: 'Delta', viewCount: 5, uploadDate: '20200101', createdAt: 7 });
    insertMusicTrack(db, { id: 'x', artistId: 'a1', title: 'Pending', downloadStatus: 'pending' });
  });

  it('returns every completed track, album or not, popular first by default', async () => {
    const result = await songs('a1');
    expect(result.total).toBe(4);
    expect(ids(result.items)).toEqual(['a', 'b', 'd', 'c']);
    expect(result.items.find((t: any) => t.id === 'b').album_title).toBe('Album al1');
  });

  it('sorts by newest, oldest and title', async () => {
    expect(ids((await songs('a1', '?sort=newest')).items)).toEqual(['d', 'b', 'a', 'c']);
    expect(ids((await songs('a1', '?sort=oldest')).items)).toEqual(['a', 'b', 'd', 'c']);
    expect(ids((await songs('a1', '?sort=title')).items)).toEqual(['a', 'b', 'c', 'd']);
    // Unknown sorts fall back to popular.
    expect(ids((await songs('a1', '?sort=bogus')).items)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('pages with limit and offset while reporting the full total', async () => {
    const first = await songs('a1', '?sort=title&limit=2&offset=0');
    const second = await songs('a1', '?sort=title&limit=2&offset=2');
    expect(ids(first.items)).toEqual(['a', 'b']);
    expect(ids(second.items)).toEqual(['c', 'd']);
    expect(second.total).toBe(4);
  });

  it('applies the artist access rules', async () => {
    await expect(songs('missing')).rejects.toMatchObject({ statusCode: 404 });
    insertMusicArtist(db, { id: 'priv', visibility: 'private' });
    await expect(songs('priv')).rejects.toMatchObject({ statusCode: 403 });
    expect((await songs('priv', '', loginAs('member'))).total).toBe(0);
  });
});

describe('GET /api/music/albums/[id]', () => {
  it('returns the album with its artist and completed tracks by track number (unnumbered last, then title)', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'The Band' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', title: 'Record', releaseYear: 2015, albumType: 'ep', coverUrl: 'https://img/cover.jpg' });
    insertMusicTrack(db, { id: 'u2', artistId: 'a1', albumId: 'al1', title: 'Zed', trackNumber: null });
    insertMusicTrack(db, { id: 'u1', artistId: 'a1', albumId: 'al1', title: 'Ace', trackNumber: null });
    insertMusicTrack(db, { id: 'n2', artistId: 'a1', albumId: 'al1', title: 'Two', trackNumber: 2 });
    insertMusicTrack(db, { id: 'n1', artistId: 'a1', albumId: 'al1', title: 'One', trackNumber: 1 });
    insertMusicTrack(db, { id: 'n10', artistId: 'a1', albumId: 'al1', title: 'Ten', trackNumber: 10 });
    insertMusicTrack(db, { id: 'pend', artistId: 'a1', albumId: 'al1', title: 'Pending', trackNumber: 3, downloadStatus: 'pending' });

    const result = await album('al1');
    expect(result.album).toMatchObject({
      id: 'al1', title: 'Record', year: 2015, type: 'ep', coverUrl: 'https://img/cover.jpg',
      manualCoverUrl: 'https://img/cover.jpg', artistId: 'a1', artistName: 'The Band',
    });
    expect(ids(result.tracks)).toEqual(['n1', 'n2', 'n10', 'u1', 'u2']);
  });

  it('falls back to a track thumbnail as the cover', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', trackNumber: 1, localThumbnailPath: '/m/t1.jpg' });
    const result = await album('al1');
    expect(result.album.coverUrl).toBe('/m/t1.jpg');
    expect(result.album.manualCoverUrl).toBeNull();
  });

  it('returns 404 for a missing album and follows the artist access rules', async () => {
    await expect(album('missing')).rejects.toMatchObject({ statusCode: 404 });
    insertMusicArtist(db, { id: 'priv', visibility: 'private' });
    insertMusicAlbum(db, { id: 'al-priv', artistId: 'priv' });
    await expect(album('al-priv')).rejects.toMatchObject({ statusCode: 403 });
    expect((await album('al-priv', loginAs('member'))).album.id).toBe('al-priv');
  });
});
