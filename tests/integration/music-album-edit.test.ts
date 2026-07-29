import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/music/albums/[id].patch';
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

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

function eventFor(albumId: string, body: any, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/admin/music/albums/${albumId}`, params: { id: albumId }, body });
}

describe('PATCH /api/admin/music/albums/[id]', () => {
  it('returns 401 for a guest', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    await expect(handler(eventFor('al1', { title: 'New Title' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('u1', 'user');
    await expect(handler(eventFor('al1', { title: 'New Title' }, cookie))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for a nonexistent album', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(handler(eventFor('missing', { title: 'X' }, cookie))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates only the fields provided', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 2020 });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('al1', { title: 'Renamed' }, cookie));
    expect(result.album.title).toBe('Renamed');
    expect(result.album.release_year).toBe(2020);
  });

  it('rejects an empty title', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('al1', { title: '' }, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('clears releaseYear to NULL when submitted empty', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 1999 });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('al1', { releaseYear: '' }, cookie));
    expect(result.album.release_year).toBeNull();
  });

  it('rejects a releaseYear outside 1900-2100', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('al1', { releaseYear: 1899 }, cookie))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('al1', { releaseYear: 2101 }, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('sets and clears coverUrl', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const setResult: any = await handler(eventFor('al1', { coverUrl: 'https://example.com/cover.jpg' }, cookie));
    expect(setResult.album.cover_url).toBe('https://example.com/cover.jpg');

    const clearResult: any = await handler(eventFor('al1', { coverUrl: '' }, cookie));
    expect(clearResult.album.cover_url).toBeNull();
  });

  it('returns manual_cover_url alongside the effective cover_url after an unrelated edit', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', trackNumber: 1, localThumbnailPath: '/downloads-music/a1/t1.jpg' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('al1', { title: 'Renamed' }, cookie));
    expect(result.album.manual_cover_url).toBeNull();
    expect(result.album.cover_url).toBe('/downloads-music/a1/t1.jpg');
  });

  it('returns 400 when the body has no updatable fields', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('al1', {}, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });
});
