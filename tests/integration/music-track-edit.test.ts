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
  beforeEach(() => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', trackNumber: 3, genre: 'Rock', language: 'en' });
  });

  it('returns 401 for a guest, 403 for a non-admin and 404 for a nonexistent track', async () => {
    await expect(handler(eventFor('t1', { title: 'New Title' }))).rejects.toMatchObject({ statusCode: 401 });
    await expect(handler(eventFor('t1', { title: 'New Title' }, loginAs('u1', 'user')))).rejects.toMatchObject({ statusCode: 403 });
    await expect(handler(eventFor('missing', { title: 'X' }, loginAs('admin1', 'admin')))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates only the fields provided, leaving others untouched', async () => {
    const cookie = loginAs('admin1', 'admin');
    let result: any = await handler(eventFor('t1', { genre: 'Electro' }, cookie));
    expect(result.track).toMatchObject({ genre: 'Electro', track_number: 3, language: 'en' });
    result = await handler(eventFor('t1', { title: 'Corrected Title', trackNumber: 7 }, cookie));
    expect(result.track).toMatchObject({ title: 'Corrected Title', track_number: 7, genre: 'Electro' });
  });

  it('clears optional fields (genre, language, trackNumber) to NULL when submitted empty', async () => {
    const cookie = loginAs('admin1', 'admin');
    const result: any = await handler(eventFor('t1', { genre: '', language: '', trackNumber: '' }, cookie));
    expect(result.track).toMatchObject({ genre: null, language: null, track_number: null });
  });

  it('returns 400 for a null body, no updatable field, a blank title or a non-positive-integer trackNumber', async () => {
    const cookie = loginAs('admin1', 'admin');
    for (const body of [null, {}, { title: '   ' }, { trackNumber: -1 }, { trackNumber: 1.5 }]) {
      await expect(handler(eventFor('t1', body, cookie)), JSON.stringify(body)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('marks the edited track as manual so the album matcher leaves it alone', async () => {
    await handler(eventFor('t1', { genre: 'Jazz' }, loginAs('admin1', 'admin')));
    expect((db.prepare('SELECT album_match_status FROM music_tracks WHERE id = ?').get('t1') as any).album_match_status).toBe('manual');
  });
});
