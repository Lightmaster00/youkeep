import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/tracks/search.get';
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

function loginAs(userId: string, role: 'admin' | 'user' = 'user', path = '/api/music/tracks/search') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId), { path });
}

const guestEvent = (path = '/api/music/tracks/search') => mockEvent(undefined, { path });

describe('GET /api/music/tracks/search', () => {
  it('finds a track by its own title via the LIKE fallback (no FTS table exists in the test DB, so this always exercises the fallback path)', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Get Lucky' WHERE id = 't1'").run();
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Around The World' WHERE id = 't2'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Lucky'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('includes the joined artist_name and album_title', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', title: 'Random Access Memories' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    db.prepare("UPDATE music_tracks SET title = 'Get Lucky' WHERE id = 't1'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Lucky'));
    expect(result.tracks[0].artist_name).toBe('Daft Punk');
    expect(result.tracks[0].album_title).toBe('Random Access Memories');
  });

  it('returns null album_title for a standalone track with no album', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'One More Time' WHERE id = 't1'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Time'));
    expect(result.tracks[0].album_title).toBeNull();
  });

  it('excludes a track whose artist is private, for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Secret Song' WHERE id = 't1'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Secret'));
    expect(result.tracks).toEqual([]);
  });

  it('includes a track whose artist is private, for a logged-in non-admin user', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Secret Song' WHERE id = 't1'").run();

    const result: any = await handler(loginAs('u1', 'user', '/api/music/tracks/search?q=Secret'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes a track whose artist is ultra_private, for a logged-in non-admin user', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Ultra Secret' WHERE id = 't1'").run();

    const result: any = await handler(loginAs('u1', 'user', '/api/music/tracks/search?q=Ultra'));
    expect(result.tracks).toEqual([]);
  });

  it('includes an ultra_private track for an admin', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Ultra Secret' WHERE id = 't1'").run();

    const result: any = await handler(loginAs('admin1', 'admin', '/api/music/tracks/search?q=Ultra'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes a track that is not yet completed', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });
    db.prepare("UPDATE music_tracks SET title = 'Still Downloading' WHERE id = 't1'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Downloading'));
    expect(result.tracks).toEqual([]);
  });
});
