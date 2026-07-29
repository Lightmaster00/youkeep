import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/music/tracks/[id].patch';
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

function eventFor(trackId: string, body: any, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/admin/music/tracks/${trackId}`, params: { id: trackId }, body });
}

describe('PATCH /api/admin/music/tracks/[id]', () => {
  it('returns 401 for a guest', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    await expect(handler(eventFor('t1', { title: 'New Title' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1', 'user');
    await expect(handler(eventFor('t1', { title: 'New Title' }, cookie))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for a nonexistent track', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(handler(eventFor('missing', { title: 'X' }, cookie))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates only the fields provided, leaving others untouched', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', trackNumber: 3, genre: 'Rock', language: 'en' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { genre: 'Electro' }, cookie));
    expect(result.track.genre).toBe('Electro');
    expect(result.track.track_number).toBe(3);
    expect(result.track.language).toBe('en');
  });

  it('clears an optional field to NULL when submitted empty', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { genre: '' }, cookie));
    expect(result.track.genre).toBeNull();
  });

  it('rejects an empty title', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('t1', { title: '   ' }, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('updates the title when a non-empty value is provided', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { title: 'Corrected Title' }, cookie));
    expect(result.track.title).toBe('Corrected Title');
  });

  it('rejects a trackNumber that is not a positive integer', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('t1', { trackNumber: -1 }, cookie))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('t1', { trackNumber: 1.5 }, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('clears trackNumber to NULL when submitted as an empty string', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', trackNumber: 5 });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { trackNumber: '' }, cookie));
    expect(result.track.track_number).toBeNull();
  });

  it('sets trackNumber when a valid positive integer is provided', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { trackNumber: 7 }, cookie));
    expect(result.track.track_number).toBe(7);
  });

  it('returns 400 when the body has no updatable fields', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('t1', {}, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });
});
