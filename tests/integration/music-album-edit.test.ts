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
  beforeEach(() => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 2020 });
  });

  it('returns 401 for a guest, 403 for a non-admin and 404 for a nonexistent album', async () => {
    await expect(handler(eventFor('al1', { title: 'New Title' }))).rejects.toMatchObject({ statusCode: 401 });
    await expect(handler(eventFor('al1', { title: 'New Title' }, loginAs('u1', 'user')))).rejects.toMatchObject({ statusCode: 403 });
    await expect(handler(eventFor('missing', { title: 'X' }, loginAs('admin1', 'admin')))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates only the fields provided, and clears releaseYear/coverUrl to NULL when submitted empty', async () => {
    const cookie = loginAs('admin1', 'admin');
    let result: any = await handler(eventFor('al1', { title: 'Renamed', coverUrl: 'https://example.com/cover.jpg' }, cookie));
    expect(result.album).toMatchObject({ title: 'Renamed', release_year: 2020, cover_url: 'https://example.com/cover.jpg' });
    result = await handler(eventFor('al1', { releaseYear: '', coverUrl: '' }, cookie));
    expect(result.album).toMatchObject({ title: 'Renamed', release_year: null, cover_url: null });
  });

  it('returns manual_cover_url alongside the effective cover_url after an unrelated edit', async () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', trackNumber: 1, localThumbnailPath: '/downloads-music/a1/t1.jpg' });
    const result: any = await handler(eventFor('al1', { title: 'Renamed' }, loginAs('admin1', 'admin')));
    expect(result.album.manual_cover_url).toBeNull();
    expect(result.album.cover_url).toBe('/downloads-music/a1/t1.jpg');
  });

  it('returns 400 for an empty title, a releaseYear outside 1900-2100 or no updatable field', async () => {
    const cookie = loginAs('admin1', 'admin');
    for (const body of [{ title: '' }, { releaseYear: 1899 }, { releaseYear: 2101 }, {}]) {
      await expect(handler(eventFor('al1', body, cookie)), JSON.stringify(body)).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});
